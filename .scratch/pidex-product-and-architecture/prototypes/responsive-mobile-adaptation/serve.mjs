import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";

const root = new URL(".", import.meta.url).pathname.slice(1);
const types = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript" };

createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const file = join(root, path === "/" ? "index.html" : path);
  response.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
  createReadStream(file).on("error", () => { response.statusCode = 404; response.end("Not found"); }).pipe(response);
}).listen(4173, "0.0.0.0", () => console.log("Prototype: http://localhost:4173/?variant=A&scenario=working"));
