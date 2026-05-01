const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();


const connectDB = require("./db");
const app = express();

connectDB();

app.get("/", (req, res) => {
    res.json({ success: true, message: "CPRS API is running" });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`CPRS server running on port ${PORT}`);
});
