import express from "express";
import morgan from "morgan";
import routes from "./routes/route.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import cookieParser from "cookie-parser";
import { ApiError } from "./utils/apiError.js";

const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

routes(app);
app.use((req, _res, next) => {
	next(new ApiError(404, "Route not found"));
});
app.use(errorHandler);

export default app;

