const express = require("express");
const app = express();
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "https://chat-app-flame-zeta.vercel.app", // frontend URL
        methods: ["GET", "POST"],
    },
});

// Middleware
app.use(cors());
app.use(bodyParser.json());

// MongoDB connection
mongoose
    .connect("mongodb+srv://sodagaramaan786:HbiVzsmAJNAm4kg4@cluster0.576stzr.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0")
    .then(() => console.log("MongoDB connected"))
    .catch((err) => console.log("MongoDB connection error:", err));

// User Schema and Model
const userSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
});
const User = mongoose.model("User", userSchema);

// Message Schema and Model
const messageSchema = new mongoose.Schema({
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
});
const Message = mongoose.model("Message", messageSchema);

// JWT Authentication Middleware
const verifyToken = (req, res, next) => {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    if (!token) {
        return res.status(401).json({ message: "Access denied, no token provided" });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(400).json({ message: "Invalid token" });
    }
};

// Routes
app.get("/", (req, res) => {
    res.send("Hello World!");
});

// Registration Endpoint
app.post("/auth/register", async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "Email already exists" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, email, password: hashedPassword });
        await newUser.save();
        res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ message: "Server error" });
    }
});

// Login Endpoint
app.post("/auth/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "User not found" });
        }
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ message: "Incorrect password" });
        }
        const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET, {
            expiresIn: "1h",
        });
        res.status(200).json({ message: "Login successful", token });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: "Server error" });
    }
});

// Fetch All Users Except Current User
app.get("/users", verifyToken, async (req, res) => {
    try {
        const users = await User.find({ _id: { $ne: req.user.userId } });
        res.status(200).json(users);
    } catch (error) {
        console.error("Error fetching users:", error);
        res.status(500).json({ message: "Failed to fetch users" });
    }
});

// Fetch Chat Messages Between Two Users
app.get("/messages/:receiverId", verifyToken, async (req, res) => {
    try {
        const { receiverId } = req.params;
        const messages = await Message.find({
            $or: [
                { sender: req.user.userId, receiver: receiverId },
                { sender: receiverId, receiver: req.user.userId },
            ],
        }).sort({ timestamp: 1 });
        res.status(200).json(messages);
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ message: "Failed to fetch messages" });
    }
});

// Socket.IO Real-time Chat
io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    socket.on("sendMessage", async ({ senderId, receiverId, content }) => {
        try {
            const message = new Message({ sender: senderId, receiver: receiverId, content });
            await message.save();

            io.to(receiverId).emit("receiveMessage", {
                senderId,
                receiverId,
                content,
                timestamp: message.timestamp,
            });
        } catch (error) {
            console.error("Error saving message:", error);
        }
    });

    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);
    });
});

// Start the server
server.listen(4000, () => {
    console.log("Server running on http://localhost:4000");
});
