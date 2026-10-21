export class ApiError extends Error{
    readonly statusCode: number;

    constructor(statusCode: number, message: string){
        super(message);
        this.name = "ApiError";
        this.statusCode = statusCode;
        Object.setPrototypeOf(this, new.target.prototype);
        Error.captureStackTrace(this, this.constructor);
    }
}
