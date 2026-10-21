import type { Schema } from "mongoose";
import { ApiError } from "../../utils/apiError.js";

/**
 * The dashboard service is read-only by contract. This is a safety net on top of the
 * read-only DB credentials: any accidental write through a model fails loudly instead
 * of touching shared production collections.
 */
const WRITE_HOOKS = [
    "save",
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "findOneAndReplace",
    "findOneAndDelete",
    "replaceOne",
    "deleteOne",
    "deleteMany",
] as const;

export const readOnlyPlugin = (schema: Schema) => {
    const reject = () => {
        throw new ApiError(500, "Dashboard service is read-only");
    };
    for (const hook of WRITE_HOOKS) {
        schema.pre(hook as any, reject);
    }
    schema.pre("insertMany", reject);
    schema.pre("bulkWrite" as any, reject);
};
