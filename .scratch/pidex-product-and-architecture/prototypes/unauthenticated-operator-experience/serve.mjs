import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const indexPath = fileURLToPath(new URL("./index.html", import.meta.url));
const port = Number.parseInt(process.env.PORT || "4175", 10);

createServer((request, response) => {
  if (request.url === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }

  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  createReadStream(indexPath).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Unauthenticated operator experience prototype: http://localhost:${port}`);
});
