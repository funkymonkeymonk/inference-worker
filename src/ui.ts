import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Connection, Client } from "@temporalio/client";
import { configFromEnvironment } from "./config.js";
import { temporalAddressFromEnvironment } from "./temporal-address.js";
import { TemporalUiReader } from "./ui/temporal-reader.js";
import { buildOverview, buildWorkItemDetail } from "./ui/view-model.js";
import { createUiServer } from "./ui/server.js";
import { YxUiReader } from "./ui/yx-reader.js";

const execFileAsync = promisify(execFile);
const config = configFromEnvironment();
const repositoryRoot = process.env.REPOSITORY_ROOT ?? process.cwd();
const yxCommand = process.env.YX_COMMAND ?? "yx";
const runYx = async (_command: string, args: string[]) => (await execFileAsync(yxCommand, args, { cwd: repositoryRoot, maxBuffer: 4 * 1024 * 1024 })).stdout;
const connection = await Connection.connect({ address: temporalAddressFromEnvironment() });
const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? "inference" });
const temporal = new TemporalUiReader(client.workflow);
const yx = new YxUiReader(runYx);

const server = createUiServer({
  async getOverview() {
    const errors: string[] = [];
    let executions = await temporal.listExecutions().catch((error) => { errors.push(`Temporal: ${String(error)}`); return []; });
    let tasks = await yx.list().catch((error) => { errors.push(`yx: ${String(error)}`); return []; });
    const dispatcher = executions.find((execution) => execution.workflowId.startsWith("dispatcher-") && execution.state && "activeTaskIds" in execution.state)?.state;
    return buildOverview(executions, tasks, dispatcher && "activeTaskIds" in dispatcher ? dispatcher : undefined, errors);
  },
  async getWorkItem(id) {
    const [execution, tasks] = await Promise.all([temporal.getExecution(`work-item-${id}`), yx.list()]);
    if (!execution) return undefined;
    const task = tasks.find((candidate) => candidate.id === id);
    const context = await yx.context(id).catch(() => task?.context);
    return buildWorkItemDetail(execution, task, context);
  },
});

server.listen(config.ui.port, config.ui.host, () => {
  console.log(`work-item UI listening at http://${config.ui.host}:${config.ui.port}`);
});

const shutdown = async () => {
  server.close();
  await connection.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
