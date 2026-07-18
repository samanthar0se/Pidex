import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const indexPath = fileURLToPath(new URL("./index.html", import.meta.url));

createServer((request, response) => {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  createReadStream(indexPath).pipe(response);
}).listen(4173, "0.0.0.0", () => {
  console.log("Pidex IA prototype: http://localhost:4173/?variant=A");
});
