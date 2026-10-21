import type { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
    ageingQuerySchema,
    breakdownQuerySchema,
    categoriesQuerySchema,
    forecastQuerySchema,
    pendingActionsQuerySchema,
    performanceQuerySchema,
    pipelineQuerySchema,
    revenueQuerySchema,
} from "../validations/dashboard.validation.js";
import dashboardService from "../services/dashboard.service.js";

const getAuth = (req: Request) => {
    const auth: {
        broker_id: string;
        firm_id: string;
        isOwner?: boolean;
    } = {
        broker_id: req.user!.broker_id,
        firm_id: req.user!.firm_id,
    };
    if (req.user!.isOwner === true) auth.isOwner = true;
    return auth;
};

export const getMeta = asyncHandler(async (req: Request, res: Response) => {
        if (!req.user) {
            res.status(401).json({success: false, message: "Unauthorized access"});
            return;
        }
        const result = await dashboardService.getMeta(getAuth(req));
        res.status(200).json({success: true, ...result});
    }
);

export const getRevenue = asyncHandler(async (req: Request, res: Response) => {
        if (!req.user) {
            res.status(401).json({success: false, message: "Unauthorized access"});
            return;
        }
        const query = revenueQuerySchema.parse(req.query);
        const result = await dashboardService.getRevenue(getAuth(req), query);
        res.status(200).json({success: true, ...result});
    }
);

export const getPipeline = asyncHandler(async (req: Request, res: Response) => {
        if (!req.user) {
            res.status(401).json({success: false, message: "Unauthorized access"});
            return;
        }
        const query = pipelineQuerySchema.parse(req.query);
        const result = await dashboardService.getPipeline(getAuth(req), query);
        res.status(200).json({success: true, ...result});
    }
);

export const getCategories = asyncHandler(async (req: Request, res: Response) => {
        if (!req.user) {
            res.status(401).json({success: false, message: "Unauthorized access"});
            return;
        }
        const query = categoriesQuerySchema.parse(req.query);
        const result = await dashboardService.getCategories(getAuth(req), query);
        res.status(200).json({success: true, ...result});
    }
);

export const getBreakdown = asyncHandler(async (req: Request, res: Response) => {
        if (!req.user) {
            res.status(401).json({success: false, message: "Unauthorized access"});
            return;
        }
        const query = breakdownQuerySchema.parse(req.query);
        const result = await dashboardService.getBreakdown(getAuth(req), query);
        res.status(200).json({success: true, ...result});
    }
);

export const getPendingActions = asyncHandler(async (req: Request, res: Response) => {
        if (!req.user) {
            res.status(401).json({success: false, message: "Unauthorized access"});
            return;
        }
        const query = pendingActionsQuerySchema.parse(req.query);
        const result = await dashboardService.getPendingActions(getAuth(req), query);
        res.status(200).json({success: true, ...result});
    }
);

export const getAgeing = asyncHandler(async (req: Request, res: Response) => {
        if (!req.user) {
            res.status(401).json({success: false, message: "Unauthorized access"});
            return;
        }
        const query = ageingQuerySchema.parse(req.query);
        const result = await dashboardService.getAgeing(getAuth(req), query);
        res.status(200).json({success: true, ...result});
    }
);

export const getPerformance = asyncHandler(async (req: Request, res: Response) => {
        if (!req.user) {
            res.status(401).json({success: false, message: "Unauthorized access"});
            return;
        }
        const query = performanceQuerySchema.parse(req.query);
        const result = await dashboardService.getPerformance(getAuth(req), query);
        res.status(200).json({success: true, ...result});
    }
);

export const getForecast = asyncHandler(async (req: Request, res: Response) => {
        if (!req.user) {
            res.status(401).json({success: false, message: "Unauthorized access"});
            return;
        }
        const query = forecastQuerySchema.parse(req.query);
        const result = await dashboardService.getForecast(getAuth(req), query);
        res.status(200).json({success: true, ...result});
    }
);
