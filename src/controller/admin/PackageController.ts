import { Request, Response } from "express";
import { PackageModel } from "../../models/schema/auth/Package";
import { NotFound, UnauthorizedError } from "../../Errors";
import { SuccessResponse } from "../../utils/response";


export const view = async (req: Request, res: Response) => {
  const packages = await PackageModel.find().populate("extras");

  return SuccessResponse(res, { data: packages }, 200);
};

// get by id 
export const getById = async (req: Request, res: Response) => {
  const id = req.params.id;
  const package_item = await PackageModel.findById(id).populate("extras");
  if (!package_item) {
    throw new NotFound('Package not found');
  }
  return SuccessResponse(res, { data: package_item }, 200);
}

export const create = async (req: Request, res: Response) => {
  const {
    name,
    description,
    monthly_price,
    quarterly_price,
    half_yearly_price,
    yearly_price,
    status,
    haveEcommerce,
    haveMobileApp,
    havePOS,
    haveReports,
    haveStockTake,
    branches,
    online_branches,
    extras
  } = req.body;

  const new_package = await PackageModel.create({
    name,
    description,
    monthly_price,
    quarterly_price,
    half_yearly_price,
    yearly_price,
    status,
    haveEcommerce,
    haveMobileApp,
    havePOS,
    haveReports,
    haveStockTake,
    branches:
      branches !== undefined && branches !== null && branches !== ""
        ? Number(branches) || 0
        : 0,
    online_branches:
      online_branches !== undefined &&
      online_branches !== null &&
      online_branches !== ""
        ? Number(online_branches) || 0
        : 0,
    extras: Array.isArray(extras) ? extras : [],
  });
  return SuccessResponse(res, { message: 'Package created successfully' }, 201);
};


export const modify = async (req: Request, res: Response) => {
  const id = req.params.id;
  let package_item = await PackageModel.findById(id);
  if (!package_item) {
    throw new NotFound('Package not found');
  }

  const {
    name,
    description,
    monthly_price,
    quarterly_price,
    half_yearly_price,
    yearly_price,
    status,
    haveEcommerce,
    haveMobileApp,
    havePOS,
    haveReports,
    haveStockTake,
    branches,
    online_branches,
    extras
  } = req.body;

  package_item.name = name ?? package_item.name;
  package_item.description = description ?? package_item.description;
  package_item.monthly_price = monthly_price ?? package_item.monthly_price;
  package_item.quarterly_price = quarterly_price ?? package_item.quarterly_price;
  package_item.half_yearly_price = half_yearly_price ?? package_item.half_yearly_price;
  package_item.yearly_price = yearly_price ?? package_item.yearly_price;
  package_item.status = status ?? package_item.status;
  package_item.haveEcommerce = haveEcommerce ?? package_item.haveEcommerce;
  package_item.haveMobileApp = haveMobileApp ?? package_item.haveMobileApp;
  package_item.havePOS = havePOS ?? package_item.havePOS;
  package_item.haveReports = haveReports ?? package_item.haveReports;
  package_item.haveStockTake = haveStockTake ?? package_item.haveStockTake;
  if (branches !== undefined && branches !== null && branches !== "") {
    package_item.branches = Number(branches) || 0;
  }
  if (
    online_branches !== undefined &&
    online_branches !== null &&
    online_branches !== ""
  ) {
    package_item.online_branches = Number(online_branches) || 0;
  }
  if (Array.isArray(extras)) {
    package_item.extras = extras;
  }
  await package_item.save();

  return SuccessResponse(res, { message: 'package updated successfully' }, 200);
};

export const delete_item = async (req: Request, res: Response) => {
  const id = req.params.id;
  const packages = await PackageModel.findByIdAndDelete(id);
  if (!packages) {
    throw new NotFound('package not found');
  }

  return SuccessResponse(res, { message: 'package deleted successfully' }, 200);
};
