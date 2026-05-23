const { connectMongo } = require("./config/database");

const connectDB = async () => {
    try {
        const conn = await connectMongo();
        console.log(`MongoDB connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`MongoDB connection error: ${error.message}`);
        if (error.code === "ECONNREFUSED" && process.env.MONGO_URI?.includes("mongodb+srv")) {
            console.error(
                "Tip: Atlas SRV DNS failed. DNS_SERVERS is set to 1.1.1.1,8.8.8.8 by default, or use a local URI: mongodb://127.0.0.1:27017/cprs"
            );
        }
        process.exit(1);
    }
};

module.exports = connectDB;
