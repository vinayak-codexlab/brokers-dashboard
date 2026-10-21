import type { Express } from "express";
import router from "./dashboard.js";
import healthRouter from "./health.js";

const baseUrl = "/v1/dashboard";

const routes=(app:Express)=>{
    app.use("/health", healthRouter);
    app.use(`${baseUrl}`, router);
};

export default routes;
