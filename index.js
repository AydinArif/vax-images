const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const express = require("express");
const { nanoid } = require("nanoid");
require("dotenv").config();

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

// Helper function to delete an image from GitHub automatically
async function deleteFromGitHub(id) {
  const path = `images/${id}.png`;
  const url = `${GITHUB_API}/repos/${process.env.GITHUB_REPO}/contents/${path}`;
  const headers = {
    Authorization: `token ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  };

  // GitHub requires the file's unique 'sha' ID to delete it safely via API
  const fileData = await axios.get(url, { headers });
  const sha = fileData.data.sha;

  await axios.delete(url, {
    headers,
    data: {
      message: `delete ${id}`,
      sha: sha,
    },
  });
}

// Helper function to fetch all hosted files from GitHub
async function fetchRepoImages() {
  const url = `${GITHUB_API}/repos/${process.env.GITHUB_REPO}/contents/images`;
  const headers = {
    Authorization: `token ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  };

  try {
    const response = await axios.get(url, { headers });
    // Filter to only grab .png files out of the folder
    return response.data.filter(file => file.name.endsWith(".png"));
  } catch (error) {
    // If the directory doesn't exist yet or is empty, return empty array
    if (error.response && error.response.status === 404) return [];
    throw error;
  }
}

// ---------------- DISCORD BOT LOGIC ----------------

async function registerSlashCommands() {
  const commands = [
    // Command 1: Convert/Upload
    new SlashCommandBuilder()
      .setName("convert")
      .setDescription("Upload an image to your database")
      .setContexts([0, 1, 2])
      .addAttachmentOption(option =>
        option.setName("image").setDescription("The image to upload").setRequired(true)
      )
      .toJSON(),

    // Command 2: Delete Image
    new SlashCommandBuilder()
      .setName("delete")
      .setDescription("Delete an image from your database using its ID")
      .setContexts([0, 1, 2])
      .addStringOption(option =>
        option.setName("id").setDescription("The 8-character ID of the image (e.g., 59U2Abz_)").setRequired(true)
      )
      .toJSON(),

    // Command 3: List Images
    new SlashCommandBuilder()
      .setName("list")
      .setDescription("Show total image count and active IDs inside your database")
      .setContexts([0, 1, 2])
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

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // HANDLE CONVERT COMMAND
  if (interaction.commandName === "convert") {
    const file = interaction.options.getAttachment("image");

    const processingEmbed = new EmbedBuilder()
      .setColor("#5865F2")
      .setDescription("⏳ **Processing your image and uploading to database...**");

    await interaction.reply({ embeds: [processingEmbed] });

    try {
      const res = await axios.get(file.url, { responseType: "arraybuffer" });
      const id = await uploadToGitHub(Buffer.from(res.data));
      const url = `${process.env.BASE_URL}/${id}`;

      const successEmbed = new EmbedBuilder()
        .setColor("#2ECC71")
        .setTitle("📦 Image Upload Successful!")
        .setDescription(`Your image has been processed and hosted under this custom domain.`)
        .addFields(
          { name: "🔗 Short URL", value: `\`${url}\`\n[Open Link](${url})`, inline: false },
          { name: "🆔 Image ID", value: `\`${id}\``, inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });
    } catch (e) {
      console.error(e);
      const errorEmbed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle("❌ Upload Failed")
        .setDescription("Something went wrong while trying to process and upload your image.");
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }

  // HANDLE DELETE COMMAND
  if (interaction.commandName === "delete") {
    const id = interaction.options.getString("id").trim();

    const processingEmbed = new EmbedBuilder()
      .setColor("#5865F2")
      .setDescription(`⏳ **Attempting to delete image \`${id}\` from database...**`);

    await interaction.reply({ embeds: [processingEmbed] });

    try {
      await deleteFromGitHub(id);

      const deleteEmbed = new EmbedBuilder()
        .setColor("#E67E22")
        .setTitle("🗑️ Image Deleted Successfully")
        .setDescription(`The image file associated with ID \`${id}\` has been removed from your database.`)
        .setTimestamp();

      await interaction.editReply({ embeds: [deleteEmbed] });
    } catch (e) {
      console.error(e);
      const errorEmbed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle("❌ Deletion Failed")
        .setDescription(`Could not find or delete an image with the ID \`${id}\`. Make sure the ID is correct.`);
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }

  // HANDLE LIST COMMAND
  if (interaction.commandName === "list") {
    const loadingEmbed = new EmbedBuilder()
      .setColor("#5865F2")
      .setDescription("⏳ **Fetching image counts and details from database...**");

    await interaction.reply({ embeds: [loadingEmbed] });

    try {
      const images = await fetchRepoImages();

      if (images.length === 0) {
        const emptyEmbed = new EmbedBuilder()
          .setColor("#95A5A6")
          .setTitle("📁 Storage Empty")
          .setDescription("No pictures found in database.")
          .setTimestamp();
        return await interaction.editReply({ embeds: [emptyEmbed] });
      }

      // Convert filenames (like "abcd1234.png") into printable formatting ids
      const idList = images.map((img, index) => {
        const cleanId = img.name.replace(".png", "");
        return `\`${index + 1}.\` **${cleanId}** ([Link](${process.env.BASE_URL}/${cleanId}))`;
      }).join("\n");

      // Handle Discord's 4096 character limit safety just in case
      const trimmedList = idList.length > 3800 ? idList.substring(0, 3800) + "\n*...and more files*" : idList;

      const listEmbed = new EmbedBuilder()
        .setColor("#3498DB")
        .setTitle("📊 Storage Directory Overview")
        .setDescription(`### Total Number Of Pictures: \`${images.length}\`\n\n${trimmedList}`)
        .setTimestamp();

      await interaction.editReply({ embeds: [listEmbed] });
    } catch (e) {
      console.error(e);
      const errorEmbed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle("❌ Fetch Failed")
        .setDescription("Could not successfully request file storage contents from databse.");
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }
});

// ---------------- EXPRESS REDIRECT SERVER ----------------
const app = express();

// Main landing page check (Fixes "Cannot GET /")
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>System Status | Vax Images</title>
        <style>
            body {
                background-color: #0f111a;
                color: #ffffff;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
            }
            .card {
                background-color: #1a1c29;
                padding: 2.5rem;
                border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                text-align: center;
                border: 1px solid #2d3142;
                max-width: 400px;
                width: 100%;
            }
            .status-icon {
                font-size: 3.5rem;
                margin-bottom: 1rem;
                animation: pulse 2s infinite;
            }
            h1 {
                margin: 0 0 0.5rem 0;
                font-size: 1.8rem;
                letter-spacing: 0.5px;
            }
            p {
                color: #8b92b6;
                margin: 0 0 1.5rem 0;
                font-size: 1rem;
            }
            .badge {
                background-color: #05c46b;
                color: #ffffff;
                padding: 0.5rem 1rem;
                border-radius: 20px;
                font-weight: 600;
                font-size: 0.85rem;
                text-transform: uppercase;
                display: inline-block;
                letter-spacing: 1px;
            }
            @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.05); }
                100% { transform: scale(1); }
            }
        </style>
    </head>
    <body>
        <div class="card">
            <div class="status-icon">🐒</div>
            <h1>Jahmunkey Image Service</h1>
            <p>Your private image redirect engine is operational.</p>
            <div class="badge">● Bot Online</div>
        </div>
    </body>
    </html>
  `);
});

// App endpoint for Render environment validation checks
app.get("/health", (req, res) => res.status(200).send("OK"));

// Main image router redirect engine
app.get("/:id", (req, res) => {
  const id = req.params.id;
  const rawUrl = `https://raw.githubusercontent.com/${process.env.GITHUB_REPO}/main/images/${id}.png`;
  res.redirect(rawUrl);
});

// Setup dynamic port binding for Render deployment stability
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log(`Express Redirect Server running on port ${PORT}`);
  await registerSlashCommands();
  client.login(process.env.DISCORD_TOKEN);
});