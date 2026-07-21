import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
createServer((request, response) => {
  const file = request.url?.startsWith("/prototype.js") ? "prototype.js" : request.url?.startsWith("/styles.css") ? "styles.css" : "index.html";
  response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
  createReadStream(join(root, file)).pipe(response);
}).listen(4175, () => console.log("Prototype: http://localhost:4175/?variant=A&state=executing"));
