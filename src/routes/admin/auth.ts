import { Router } from "express";
import { create_admin, login_admin } from "../../controller/Login/auth";
// import { authenticated } from '../../middlewares/authenticated';
import { validate } from "../../middlewares/validation";
import { createAdminSchema, loginSchema } from "../../validation/user/auth";
import { catchAsync } from "../../utils/catchAsync";
import { authorizeRole } from "../../middlewares/authorizeRole";

export const authRouter = Router();

authRouter.post("/login", validate(loginSchema), catchAsync(login_admin));

authRouter.post(
  "/create-admin",
  validate(createAdminSchema),
  catchAsync(create_admin),
);

// Export the authRouter to be used in the main app
export default authRouter;
