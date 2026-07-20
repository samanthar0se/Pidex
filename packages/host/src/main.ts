import { provisionPackagedHostCertificate } from "./certificate.js";
import { runHost } from "./run-host.js";

await runHost("product", provisionPackagedHostCertificate);
