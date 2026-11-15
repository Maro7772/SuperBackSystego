import { Router } from "express";
import {
  getAllClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  select,
  rebuildClientFrontend,
  deployClientBackend,
  viewSelection,
  regenerateClientEnv,
  installClientSsl,
  regenerateApiKey,
  generateApiKeysForExistingClients,
  renewClientSubscription,
  setClientSubscriptionEnd,
} from "../../controller/admin/ClientController";
import {
  installClientDependencies,
  diagnoseClient,
  testSslInstallation,
} from "../../utils/ClientProvisioner";
import {
  createClientValidator,
  updateClientValidator,
} from "../../validation/admin/clientValidator";
import { validate } from "../../middlewares/validation";
import { authenticated } from "../../middlewares/authenticated";
import { authorizeRole } from "../../middlewares/authorizeRole";
import { updateOperationReportStatus } from "../../controller/admin/OperationReportsController";
const router = Router();

router.use(authenticated);

// ✅ Allow super_admin AND viewer to update status
router.patch("/:id/status", authorizeRole("super_admin", "viewer"), updateOperationReportStatus);

router.use(authorizeRole("super_admin"));

router.get("/select", select);
router.get("/selectionpackages", viewSelection);
router.post("/generate-all-api-keys", generateApiKeysForExistingClients);
router.get("/", getAllClients);
router.get("/:id", getClientById);
router.post("/", validate(createClientValidator), createClient);
router.put("/:id", validate(updateClientValidator), updateClient);
router.post("/:id/renew-subscription", renewClientSubscription);
router.patch("/:id/subscription-end", setClientSubscriptionEnd);
router.delete("/:id", deleteClient);
router.post("/:id/rebuild-frontend", rebuildClientFrontend);
router.post("/:id/deploy-backend", deployClientBackend);
router.post("/:id/regenerate-env", regenerateClientEnv);
router.post("/:id/install-ssl", installClientSsl);
router.post("/:id/install-dependencies", installClientDependencies);
router.post("/:id/regenerate-api-key", regenerateApiKey);
router.post("/diagnose", diagnoseClient);
router.post("/diagnose-ssl", testSslInstallation);

export default router;
