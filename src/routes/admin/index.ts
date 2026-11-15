import { Router } from "express";
import authRouter from "./auth";
import CouponRouter from "./CouponRoutes";
import PackageRouter from "./PackageRoutes";
import ExtraRouter from "./ExtraRoutes";
import ClientRoutes from "./clientRoutes";
import PaymentMethodRoutes from "./paymentMethodRoutes";
import ThemeRoutes from "./themesRoutes";
import ThemeCategoryRoutes from "./ThemeCategoryRoutes";
import GatewayRouter from "../../utils/dbGateway";
import OperationReportRouter from "./OperationReportRoutes";
import PaymentApprovalRouter from "./paymentApprovalRoutes";
import router from "./clientRoutes";
//import { authenticated } from "../../middlewares/authenticated";
//import {  authorizeRoles } from "../../middlewares/authorized";

export const route = Router();

route.use("/auth", authRouter);
// route.use(authenticated,authorizeRoles("admin"));

route.use("/coupons", CouponRouter);
route.use("/packages", PackageRouter);
route.use("/extras", ExtraRouter);
route.use("/clients", ClientRoutes);
route.use("/payment-methods", PaymentMethodRoutes);
route.use("/themes", ThemeRoutes);
route.use("/theme-categories", ThemeCategoryRoutes);
route.use("/db", GatewayRouter);
route.use("/operation-reports", OperationReportRouter);
route.use("/payments", PaymentApprovalRouter);

export default route;
