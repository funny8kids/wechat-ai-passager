// JSON 文件存储（文章/设置/发布队列）：原子写入 + 损坏自动备份，绝不静默吞数据
import { promises as fs } from "node:fs";
import path from "node:path";

export class JsonStore {
  constructor(dir) {
    this.dir = dir;
    this.files = {};
    this.corrupted = []; // 本次运行中检测到损坏并已备份的文件名，主进程负责向用户显形
    this._tail = Promise.resolve(); // 写队列：串行化 rename，规避 Windows 并发覆盖 EPERM
  }
  file(name) {
    if (!this.files[name]) this.files[name] = path.join(this.dir, `${name}.json`);
    return this.files[name];
  }
  async load(name, fallback) {
    const f = this.file(name);
    let raw;
    try {
      raw = await fs.readFile(f, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return fallback; // 首次启动没有文件属正常
      // 读取失败（占用/权限）必须抛错：若当作"无数据"返回，随后的保存会整体覆盖真数据
      throw new Error(`读取 ${name}.json 失败：${e.code || e.message}`);
    }
    try {
      return JSON.parse(raw);
    } catch {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      try { await fs.copyFile(f, `${f}.corrupted-${stamp}`); } catch {}
      if (!this.corrupted.includes(name)) this.corrupted.push(name);
      return fallback;
    }
  }
  save(name, data) {
    const run = () => this._writeAtomic(name, data);
    const p = this._tail.then(run, run);
    this._tail = p.catch(() => {});
    return p;
  }
  async _writeAtomic(name, data) {
    await fs.mkdir(this.dir, { recursive: true });
    // 唯一临时名：并发写同一逻辑文件也不会互相踩到同一个 .tmp
    const tmp = `${this.file(name)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    const h = await fs.open(tmp, "w");
    try {
      await h.writeFile(JSON.stringify(data, null, 2), "utf8");
      await h.sync(); // 落盘后再 rename：断电不产生半截 JSON
    } finally {
      await h.close();
    }
    for (let i = 0; ; i++) {
      try { await fs.rename(tmp, this.file(name)); return; }
      catch (e) {
        // Windows 下目标被扫描软件短暂占用时重试；仍失败则清掉临时文件并抛错（不静默丢数据）
        if (e.code !== "EPERM" && e.code !== "EBUSY" && e.code !== "EACCES") { await fs.rm(tmp, { force: true }); throw e; }
        if (i >= 5) { await fs.rm(tmp, { force: true }); throw new Error(`保存 ${name}.json 失败（文件被占用），请关闭正在读取它的程序后重试`); }
        await new Promise((r) => setTimeout(r, 40 * (i + 1)));
      }
    }
  }
}
