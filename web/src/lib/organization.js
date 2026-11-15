import { api, post } from "./api.js";
import { organizationClient } from "./spaces/organization-client.js";

// Call with the selected paired host; a later switch never retargets a request.
export const computerOrganization = (host) =>
  organizationClient(
    host,
    (method, document, target) =>
      method === "GET"
        ? api("/organization", { host: target })
        : post("/organization", document, { host: target }),
  );
