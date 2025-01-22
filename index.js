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
const nodemailer = require("nodemailer");

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ["http://localhost:3000", "https://chat-app-flame-zeta.vercel.app"],
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


        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: process.env.EMAIL_USER, // Your email from .env
                pass: process.env.EMAIL_PASS, // Your email password or app password from .env
            },
        });

        // Email content to yourself
         // Email content to the admin
         const adminMailOptions = {
            from: process.env.EMAIL_USER, // Sender email
            to: process.env.EMAIL_USER, // Send to your email
            subject: "New User Registration",
            html: `
                <p><strong>New User Registered!</strong></p>
                <p><strong>Username:</strong> ${username}</p>
                <p><strong>Email:</strong> ${email}</p>
            `,
        };

        // Email content to the user
        const userMailOptions = {
            from: process.env.EMAIL_USER, // Sender email
            to: email, // User's email
            subject: "Welcome to Our Website",
            html: `
                <p>Hello <strong>${username}</strong>,</p>
                <p>Thank you for registering on our platform. We're excited to have you on board!</p>
                <p>If you have any questions, feel free to reply to this email.</p>
                <p>Best regards,</p>
                
            `,
        };

        // Send emails to both admin and user
        await transporter.sendMail(adminMailOptions);
        await transporter.sendMail(userMailOptions);

        // Respond with success
        res.status(201).json({ message: "User registered successfully, User and admin notified" });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ message: "Server error" });
    }
});


// Login Endpoint
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

        const token = jwt.sign(
            { userId: user._id, username: user.username }, // Include important user details in the token
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        // Send both token and user details
        res.status(200).json({
            message: "Login successful",
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
            },
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ message: "Server error" });
    }
});



// Protected Route (Example)
app.get("/protected", verifyToken, (req, res) => {
    res.status(200).json({ message: "This is a protected route", user: req.user });
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
// Socket.IO Real-time Chat
const activeUsers = new Map();

io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    // Handle user connection
    socket.on("userConnected", (userId) => {
        if (!userId) {
            console.error("userConnected event received without userId");
            return;
        }

        activeUsers.set(userId, socket.id); // Map userId to socket ID
        socket.join(userId); // Join the room identified by userId
        console.log(`User ${userId} connected and joined room ${userId}`);
    });

    // Handle message sending
    socket.on("sendMessage", async ({ senderId, receiverId, content }, callback) => {
        console.log("Received message data:", { senderId, receiverId, content });

        if (!senderId || !receiverId || !content) {
            console.error("Invalid message data:", { senderId, receiverId, content });
            callback({ success: false });
            return;
        }

        try {
            // Save message to the database
            const message = new Message({ sender: senderId, receiver: receiverId, content });
            const savedMessage = await message.save();

            // Emit the message to the receiver's room
            io.to(receiverId).emit("receiveMessage", {
                senderId,
                receiverId,
                content,
                timestamp: savedMessage.timestamp,
            });

            // Optionally emit to sender for confirmation
            io.to(senderId).emit("receiveMessage", {
                senderId,
                receiverId,
                content,
                timestamp: savedMessage.timestamp,
            });

            callback({ success: true });
        } catch (error) {
            console.error("Error saving message to database:", error);
            callback({ success: false });
        }
    });

    // Handle user disconnection
    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id);

        for (const [userId, socketId] of activeUsers.entries()) {
            if (socketId === socket.id) {
                activeUsers.delete(userId);
                console.log(`User ${userId} disconnected`);
            }
        }
    });
});



// Start the server
server.listen(4000, () => {
    console.log("Server running on http://localhost:4000");
});
