const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require("discord.js");
const axios = require("axios");
const express = require("express");
const { nanoid } = require("nanoid");
require("dotenv").config();

// Initialize Discord Client
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const GITHUB_API = "https://api.github.com";

// Helper function to upload image buffer to GitHub
async function uploadToGitHub(buffer) {
  const id = nanoid(8);
  const path = `images/${id}.png`;
  const content = buffer.toString("base64");

  await axios.put(
    `${GITHUB_API}/repos/${process.env.GITHUB_REPO}/contents/${path}`,
    {
      message: `upload ${id}`,
      content: content,
    },
    {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  return id;
}

// ---------------- DISCORD BOT LOGIC ----------------

// Automatically register slash commands when the bot starts
async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("convert")
      .setDescription("Upload an image to your custom domain")
      .addAttachmentOption(option =>
        option.setName("image").setDescription("The image to upload").setRequired(true)
      )
      .toJSON()
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log("Started refreshing application (/) commands.");
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error("Error registering slash commands:", error);
  }
}

// Listen for the 'convert' command interaction
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "convert") {
    const file = interaction.options.getAttachment("image");

    // Defer the reply to give the bot 15 minutes to process instead of the strict 3-second limit
    await interaction.deferReply();

    try {
      // Download the image from Discord
      const res = await axios.get(file.url, {
        responseType: "arraybuffer",
      });

      // Upload to GitHub
      const id = await uploadToGitHub(Buffer.from(res.data));
      const url = `${process.env.BASE_URL}/${id}`;

      // Edit the deferred reply with the final link
      await interaction.editReply(`✅ Uploaded: ${url}`);
    } catch (e) {
      console.error(e);
      await interaction.editReply("❌ Failed to process and upload image.");
    }
  }
});

// ---------------- EXPRESS REDIRECT SERVER ----------------
const app = express();

// Health check endpoint for Koyeb deployment
app.get("/health", (req, res) => res.send("OK"));

// Redirect handler
app.get("/:id", (req, res) => {
  const id = req.params.id;
  const rawUrl = `https://raw.githubusercontent.com/${process.env.GITHUB_REPO}/main/images/${id}.png`;
  
  res.redirect(rawUrl);
});

// Start everything up
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Express Redirect Server running on port ${PORT}`);
  
  // Register commands and log into Discord after Express starts
  await registerSlashCommands();
  client.login(process.env.DISCORD_TOKEN);
});