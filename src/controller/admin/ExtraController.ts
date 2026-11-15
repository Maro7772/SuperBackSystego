import { Request, Response } from "express";
import { ExtraModel } from "../../models/schema/auth/Extra";
import { NotFound } from "../../Errors";
import { SuccessResponse } from "../../utils/response";

export const view = async (req: Request, res: Response) => {
  const extras = await ExtraModel.find().sort({ createdAt: -1 });

  return SuccessResponse(res, { data: extras }, 200);
};

export const getById = async (req: Request, res: Response) => {
  const id = req.params.id;
  const extra = await ExtraModel.findById(id);
  if (!extra) {
    throw new NotFound("Extra not found");
  }
  return SuccessResponse(res, { data: extra }, 200);
};

export const create = async (req: Request, res: Response) => {
  const { name, ar_name, description, ar_description, is_recurring } = req.body;

  await ExtraModel.create({
    name,
    ar_name,
    description,
    ar_description,
    is_recurring: is_recurring ?? false,
  });

  return SuccessResponse(res, { message: "Extra created successfully" }, 201);
};

export const modify = async (req: Request, res: Response) => {
  const id = req.params.id;
  const extra = await ExtraModel.findById(id);
  if (!extra) {
    throw new NotFound("Extra not found");
  }

  const { name, ar_name, description, ar_description, is_recurring } = req.body;

  extra.name = name ?? extra.name;
  extra.ar_name = ar_name ?? extra.ar_name;
  extra.description = description ?? extra.description;
  extra.ar_description = ar_description ?? extra.ar_description;
  if (is_recurring !== undefined) extra.is_recurring = is_recurring;

  await extra.save();

  return SuccessResponse(res, { message: "Extra updated successfully" }, 200);
};

export const delete_item = async (req: Request, res: Response) => {
  const id = req.params.id;
  const extra = await ExtraModel.findByIdAndDelete(id);
  if (!extra) {
    throw new NotFound("Extra not found");
  }

  return SuccessResponse(res, { message: "Extra deleted successfully" }, 200);
};
