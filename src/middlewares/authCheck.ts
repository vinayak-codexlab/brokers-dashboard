import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import {env} from "../config/env.js";
import { ApiError } from "../utils/apiError.js";

export const Protect = (req:Request, res:Response, next:NextFunction)=>{
    const authHeader = req.headers.authorization;
    const rawToken =
        req.cookies?.accessToken ||
        req.cookies?.user_token ||
        req.cookies?.token ||
        authHeader;
    if(!rawToken){
        return next(new ApiError(401, "Authentication Failed !"));
    }
    if (authHeader && !authHeader.startsWith("Bearer ")) {
        return next(new ApiError(401, "Authentication scheme must be Bearer"));
    }
    const accessToken = rawToken.startsWith("Bearer ")
        ? rawToken.split(" ")[1]
        : rawToken;

    if (!accessToken) {
        return next(new ApiError(401, "Authentication Failed !!"));
    }
    try{
        const decoded = jwt.verify(accessToken, env.JWT_SECRET) as {
            firm_id?: string;
            firm_name?: string;
            sub?: string;
            brokerId?: string;
            firmId?: string;
            isOwner?: boolean;
            role?: string;
        };
        const broker_id = decoded.sub ?? decoded.brokerId;
        const firm_id = decoded.firm_id ?? decoded.firmId ?? decoded.firm_name;

        if (!broker_id || !firm_id) {
            return next(new ApiError(401, "Authentication fields are missing"));
        }

        req.user = { broker_id, firm_id };
        // Firm-wide dashboard scope only from the signed token; everyone else sees their own leads.
        if (decoded.isOwner === true || decoded.role === "owner") req.user.isOwner = true;
        next();
    } catch(error:any){
        console.log("JWT Verification Error:", error?.message || error);
        next(new ApiError(401, "Authentication Failed !!!"));
    }
};
