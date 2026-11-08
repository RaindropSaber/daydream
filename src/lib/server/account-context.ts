import { AsyncLocalStorage } from "node:async_hooks";
import { database } from "./db";
import { AppError } from "../domain";
const scope = new AsyncLocalStorage<string>();
export const currentAccount = () => scope.getStore();
export const withAccount = <T>(id: string, action: () => T) =>
  scope.run(id, action);
export async function assertProjectAccess(id: string) {
  const user = currentAccount();
  if (!user) return;
  if (
    !(
      await database().query(
        "SELECT 1 FROM projects WHERE id=$1 AND user_id=$2",
        [id, user],
      )
    ).rowCount
  )
    throw new AppError("项目不存在", 404);
}
export async function inProjectAccount<T>(
  projectId: string,
  action: () => Promise<T>,
) {
  const row = (
    await database().query("SELECT user_id FROM projects WHERE id=$1", [
      projectId,
    ])
  ).rows[0];
  if (row?.user_id) return withAccount(row.user_id, action);
  return action();
}
