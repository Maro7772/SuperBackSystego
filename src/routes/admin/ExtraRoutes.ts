import { Router } from "express";
import {
  view,
  getById,
  create,
  modify,
  delete_item,
} from "../../controller/admin/ExtraController";
import { authenticated } from "../../middlewares/authenticated";
import { catchAsync } from "../../utils/catchAsync";

export const ExtraRouter = Router();

ExtraRouter.use(authenticated);

ExtraRouter.get("/", catchAsync(view));
ExtraRouter.get("/:id", catchAsync(getById));
ExtraRouter.post("/add", catchAsync(create));
ExtraRouter.put("/update/:id", catchAsync(modify));
ExtraRouter.delete("/delete_item/:id", catchAsync(delete_item));

export default ExtraRouter;
