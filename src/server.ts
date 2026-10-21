import app from "./app.js";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";

const startServer = async()=>{
    try{
        await connectDB();
        app.listen(env.PORT,()=>{
            console.log(`Server is running on PORT ${env.PORT}`);
        });
    } catch(err){
        console.error("Failed to start the server !", err);
        process.exit(1);
    }
}

startServer();
