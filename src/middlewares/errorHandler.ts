import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/apiError.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error("[ERROR]", error.name, error.message);
    
    if (error instanceof ZodError) {
        return res.status(400).json({
            success: false,
            message: error.issues[0]?.message || "Validation failed",
        });
    }

    if (error instanceof SyntaxError && "body" in error) {
        return res.status(400).json({
            success: false,
            message: "Malformed JSON request body",
        });
    }

    if(error instanceof ApiError){
        return res.status(error.statusCode).json({
            success: false,
            message: error.message,
        });
    }

    const maybeStatusError = error as Error & { statusCode?: number };
    if (typeof maybeStatusError.statusCode === "number") {
        return res.status(maybeStatusError.statusCode).json({
            success: false,
            message: maybeStatusError.message
        });
    }

    // Query deadline exceeded / DB unreachable: bounded failure instead of a hang or a 500.
    const mongoError = error as Error & { code?: unknown; codeName?: string };
    if (
        mongoError.code === 50 ||
        mongoError.codeName === "MaxTimeMSExpired" ||
        mongoError.name === "MongoNetworkError" ||
        mongoError.name === "MongoServerSelectionError" ||
        mongoError.name === "MongooseServerSelectionError"
    ) {
        return res.status(503).json({ success: false, message: "Dashboard data is temporarily unavailable" });
    }

    const castError = error as Error & { name?: string; kind?: string; path?: string };
    if (castError.name === "CastError") {
        console.error("[CastError]", castError.path, castError.kind);
        return res.status(400).json({ success: false, message: "Invalid id" });
    }

    if (castError.name === "ValidationError") {
        return res.status(400).json({ success: false, message: "Validation failed" });
    }

    return res.status(500).json({success:false, message:"Internal server error !"});
};
