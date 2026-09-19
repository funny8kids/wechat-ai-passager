// JSON 文件存储（文章/设置/发布队列），原子写入
import { promises as fs } from "node:fs";
import path from "node:path";

export class JsonStore {
  constructor(dir) {
    this.dir = dir;
    this.files = {};
  }
  file(name) {
    if (!this.files[name]) this.files[name] = path.join(this.dir, `${name}.json`);
    return this.files[name];
  }
  async load(name, fallback) {
    try {
      return JSON.parse(await fs.readFile(this.file(name), "utf8"));
    } catch {
      return fallback;
    }
  }
  async save(name, data) {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = this.file(name) + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tmp, this.file(name));
  }
}
