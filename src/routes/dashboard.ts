import { Router } from "express";
import { Protect } from "../middlewares/authCheck.js";
import {
    getAgeing,
    getBreakdown,
    getCategories,
    getForecast,
    getMeta,
    getPendingActions,
    getPerformance,
    getPipeline,
    getRevenue,
} from "../controllers/dashboard.controller.js";

const router = Router();

router.use(Protect);

router.route("/meta").get(getMeta);
router.route("/revenue").get(getRevenue);
router.route("/pipeline").get(getPipeline);
router.route("/categories").get(getCategories);
router.route("/breakdown").get(getBreakdown);
router.route("/pending-actions").get(getPendingActions);
router.route("/ageing").get(getAgeing);
router.route("/performance").get(getPerformance);
router.route("/forecast").get(getForecast);

export default router;
