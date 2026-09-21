// 本地定时调度器：到点执行发布任务（单机方案，电脑需开机联网）
// 任务生命周期: pending -> running -> done | failed(可重试)
import { randomUUID } from "node:crypto";

export class Scheduler {
  /**
   * @param {import('./store.mjs').JsonStore} store
   * @param {(task)=>Promise<void>} executor 实际执行函数
   * @param {(evt)=>void} notify 状态变更回调（用于系统通知/刷新UI）
   */
  constructor(store, executor, notify = () => {}) {
    this.store = store;
    this.executor = executor;
    this.notify = notify;
    this.timer = null;
  }

  async all() {
    return this.store.load("queue", []);
  }
  async persist(tasks) {
    await this.store.save("queue", tasks);
  }

  async add(task) {
    const tasks = await this.all();
    const item = {
      id: randomUUID().slice(0, 8),
      status: "pending",
      createdAt: Date.now(),
      log: [],
      ...task,
    };
    tasks.unshift(item);
    await this.persist(tasks);
    this.notify({ type: "queue-add", task: item });
    return item;
  }

  async update(id, patch) {
    const tasks = await this.all();
    const i = tasks.findIndex((t) => t.id === id);
    if (i < 0) return null;
    tasks[i] = { ...tasks[i], ...patch };
    await this.persist(tasks);
    this.notify({ type: "queue-update", task: tasks[i] });
    return tasks[i];
  }

  async remove(id) {
    const tasks = (await this.all()).filter((t) => t.id !== id);
    await this.persist(tasks);
    this.notify({ type: "queue-remove", id });
  }

  start(intervalMs = 20_000) {
    this.stop();
    const fail = (e) => this.notify({ type: "scheduler-error", error: String(e?.message || e) });
    this.timer = setInterval(() => this.tick().catch(fail), intervalMs);
    this.recoverStuck().catch(fail);
    this.tick().catch(fail);
  }
  // 上次运行崩溃/强退会把任务永久卡在 running：启动时复位为可重试的 failed
  async recoverStuck() {
    const tasks = await this.all();
    let fixed = 0;
    for (const t of tasks) {
      if (t.status === "running") { t.status = "failed"; t.error = "任务被应用退出中断，可手动重试"; t.nextRetryAt = 0; fixed++; }
    }
    if (fixed) {
      await this.persist(tasks);
      this.notify({ type: "scheduler-recovered", count: fixed });
    }
  }
  // 只执行指定任务（区别于 tick 顺带跑其它到期任务）
  async runOne(id) {
    const t = (await this.all()).find((x) => x.id === id);
    if (!t) throw new Error("任务不存在");
    await this.update(id, { status: "running", startedAt: Date.now() });
    try {
      await this.executor(t);
      await this.update(id, { status: "done", finishedAt: Date.now() });
      this.notify({ type: "publish-success", task: t });
    } catch (e) {
      await this.update(id, {
        status: "failed",
        error: String(e.message || e),
        wxcode: e.wxcode || null,
        retryCount: (t.retryCount || 0) + 1,
        autoRetry: t.autoRetry,
        nextRetryAt: Date.now() + 5 * 60_000,
      });
      this.notify({ type: "publish-failed", task: t, error: String(e.message || e) });
      throw e;
    }
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    const now = Date.now();
    const tasks = await this.all();
    for (const t of tasks) {
      const due = t.status === "pending" && t.publishAt && t.publishAt <= now;
      const retry = t.status === "failed" && t.autoRetry && t.retryCount < 3 && (t.nextRetryAt || 0) <= now;
      if (!due && !retry) continue;
      await this.update(t.id, { status: "running", startedAt: now });
      try {
        await this.executor(t);
        await this.update(t.id, { status: "done", finishedAt: now });
        this.notify({ type: "publish-success", task: t });
      } catch (e) {
        await this.update(t.id, {
          status: "failed",
          error: String(e.message || e),
          wxcode: e.wxcode || null,
          retryCount: (t.retryCount || 0) + 1,
          autoRetry: retry || t.autoRetry,
          nextRetryAt: Date.now() + 5 * 60_000,
        });
        this.notify({ type: "publish-failed", task: t, error: String(e.message || e) });
      }
    }
  }
}
