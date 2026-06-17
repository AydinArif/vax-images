const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const axios = require("axios");
const express = require("express");
const { nanoid } = require("nanoid");
require("dotenv").config();

const bootTime = Date.now();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const GITHUB_API = "https://api.github.com";

function getUptimeString() {
  let totalSeconds = Math.floor((Date.now() - bootTime) / 1000);
  let days = Math.floor(totalSeconds / 86400);
  totalSeconds %= 86400;
  let hours = Math.floor(totalSeconds / 3600);
  totalSeconds %= 3600;
  let minutes = Math.floor(totalSeconds / 60);
  let seconds = totalSeconds % 60;
  return `${days}d, ${hours}h, ${minutes}m, ${seconds}s`;
}

// Dynamically extracts and preserves any matching format extension seamlessly
async function uploadToGitHub(buffer, originalFilename) {
  const id = nanoid(8);
  const ext = originalFilename.split('.').pop().toLowerCase();
  const path = `images/${id}.${ext}`; 
  const content = buffer.toString("base64");

  await axios.put(
    `${GITHUB_API}/repos/${process.env.GITHUB_REPO}/contents/${path}`,
    {
      message: `upload ${id}.${ext}`,
      content: content,
    },
    {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  return `${id}.${ext}`;
}

async function deleteFromGitHub(idOrFilename) {
  const url = `${GITHUB_API}/repos/${process.env.GITHUB_REPO}/contents/images`;
  const headers = {
    Authorization: `token ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  };

  const response = await axios.get(url, { headers });
  const targetFile = response.data.find(file => file.name.startsWith(idOrFilename));

  if (!targetFile) throw new Error("File not found");

  const fileData = await axios.get(targetFile.url, { headers });
  const sha = fileData.data.sha;

  await axios.delete(targetFile.url, {
    headers,
    data: {
      message: `delete ${targetFile.name}`,
      sha: sha,
    },
  });
}

async function fetchRepoImages() {
  const url = `${GITHUB_API}/repos/${process.env.GITHUB_REPO}/contents/images`;
  const headers = {
    Authorization: `token ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  };

  try {
    const response = await axios.get(url, { headers });
    // Grabs any files inside your assets directory dynamically
    return response.data.filter(file => /\.(png|jpg|jpeg|gif|mp4|mov|webm|avi|mkv)$/i.test(file.name));
  } catch (error) {
    if (error.response && error.response.status === 404) return [];
    throw error;
  }
}

// ---------------- DISCORD BOT LOGIC ----------------

async function registerSlashCommands() {
  const commands = [
    // Command 1: Image Upload (Updated Name)
    new SlashCommandBuilder()
      .setName("image-upload")
      .setDescription("Upload an image asset to your custom domain")
      .setContexts([0, 1, 2])
      .addAttachmentOption(option =>
        option.setName("image").setDescription("The image file to upload").setRequired(true)
      )
      .toJSON(),

    // Command 2: Video Upload (Updated Name)
    new SlashCommandBuilder()
      .setName("video-upload")
      .setDescription("Upload a video clip to your custom domain")
      .setContexts([0, 1, 2])
      .addAttachmentOption(option =>
        option.setName("video").setDescription("The video file to upload").setRequired(true)
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName("delete")
      .setDescription("Delete a file from your repository using its ID")
      .setContexts([0, 1, 2])
      .addStringOption(option =>
        option.setName("id").setDescription("The character ID code of the file").setRequired(true)
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName("list")
      .setDescription("Show total asset counts and active IDs inside your storage")
      .setContexts([0, 1, 2])
      .toJSON(),

    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Check Jahmunkey's dynamic connection latency and system uptime")
      .setContexts([0, 1, 2])
      .toJSON()
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log("Started refreshing application (/) commands.");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error("Error registering slash commands:", error);
  }
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // PROCESS COMBINED UPLOAD LOGIC
  if (interaction.commandName === "image-upload" || interaction.commandName === "video-upload") {
    const isVideoCmd = interaction.commandName === "video-upload";
    const file = interaction.options.getAttachment(isVideoCmd ? "video" : "image");

    const processingEmbed = new EmbedBuilder()
      .setColor("#5865F2")
      .setDescription(`⏳ **Processing your file and syncing upstream to GitHub...**`);

    await interaction.reply({ embeds: [processingEmbed] });

    try {
      const res = await axios.get(file.url, { responseType: "arraybuffer" });
      const fullFilename = await uploadToGitHub(Buffer.from(res.data), file.name);
      
      const shortId = fullFilename.split('.')[0];
      const ext = fullFilename.split('.').pop().toLowerCase();
      const isVideoFile = ["mp4", "mov", "webm", "avi", "mkv"].includes(ext);

      const url = `${process.env.BASE_URL}/${shortId}`;

      const successEmbed = new EmbedBuilder()
        .setColor("#2ECC71")
        .setTitle(`📦 ${isVideoFile ? "Video" : "Image"} Upload Successful!`)
        .setDescription(`Your file has been processed and hosted under your custom domain.`)
        .addFields(
          { name: "🔗 Short URL", value: `\`${url}\`\n[Open Link](${url})`, inline: false },
          { name: "🆔 File ID", value: `\`${shortId}\` (\`.${ext}\`)`, inline: true }
        )
        .setTimestamp();

      if (isVideoFile) {
        await interaction.editReply({ embeds: [successEmbed], content: `🎥 **Video Player Preview:**\n${url}` });
      } else {
        await interaction.editReply({ embeds: [successEmbed], content: null });
      }
    } catch (e) {
      console.error(e);
      const errorEmbed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle("❌ Upload Failed")
        .setDescription("Something went wrong while trying to process your asset file.");
      await interaction.editReply({ embeds: [errorEmbed], content: null });
    }
  }

  // HANDLE DELETE COMMAND
  if (interaction.commandName === "delete") {
    const id = interaction.options.getString("id").trim();

    const processingEmbed = new EmbedBuilder()
      .setColor("#5865F2")
      .setDescription(`⏳ **Attempting to purge asset reference \`${id}\` from GitHub...**`);

    await interaction.reply({ embeds: [processingEmbed] });

    try {
      await deleteFromGitHub(id);

      const deleteEmbed = new EmbedBuilder()
        .setColor("#E67E22")
        .setTitle("🗑️ Storage Cleared")
        .setDescription(`The asset file associated with ID \`${id}\` has been scrubbed from your GitHub repository.`)
        .setTimestamp();

      await interaction.editReply({ embeds: [deleteEmbed] });
    } catch (e) {
      console.error(e);
      const errorEmbed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle("❌ Deletion Failed")
        .setDescription(`Could not find or delete a file with the ID reference \`${id}\`.`);
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }

  // HANDLE LIST COMMAND
  if (interaction.commandName === "list") {
    const loadingEmbed = new EmbedBuilder()
      .setColor("#5865F2")
      .setDescription("⏳ **Fetching media counts and file index from GitHub...**");

    await interaction.reply({ embeds: [loadingEmbed] });

    try {
      const images = await fetchRepoImages();

      if (images.length === 0) {
        const emptyEmbed = new EmbedBuilder()
          .setColor("#95A5A6")
          .setTitle("📁 Storage Empty")
          .setDescription("There are currently no assets hosted inside your repository path.")
          .setTimestamp();
        return await interaction.editReply({ embeds: [emptyEmbed] });
      }

      const idList = images.map((img, index) => {
        const cleanId = img.name.split('.')[0];
        const ext = img.name.split('.').pop();
        const icon = ["mp4", "mov", "webm", "avi", "mkv"].includes(ext.toLowerCase()) ? "🎥" : "🖼️";
        return `\`${index + 1}.\` ${icon} **${cleanId}** (\`.${ext}\`) ([Link](${process.env.BASE_URL}/${cleanId}))`;
      }).join("\n");

      const trimmedList = idList.length > 3800 ? idList.substring(0, 3800) + "\n*...and more files*" : idList;

      const listEmbed = new EmbedBuilder()
        .setColor("#3498DB")
        .setTitle("📊 Storage Directory Overview")
        .setDescription(`### Total Hosted Media: \`${images.length}\`\n\n${trimmedList}`)
        .setTimestamp();

      await interaction.editReply({ embeds: [listEmbed] });
    } catch (e) {
      console.error(e);
      const errorEmbed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle("❌ Fetch Failed")
        .setDescription("Could not successfully request repository directory listings.");
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }

  // HANDLE PING COMMAND
  if (interaction.commandName === "ping") {
    const latency = client.ws.ping;
    const uptime = getUptimeString();

    const pingEmbed = new EmbedBuilder()
      .setColor("#9B59B6")
      .setTitle("🐒 Jahmunkey Status")
      .addFields(
        { name: "Connection", value: "✅ Online", inline: true },
        { name: "Latency", value: `📡 ${latency}ms`, inline: true },
        { name: "Uptime", value: `⏳ ${uptime}`, inline: false }
      )
      .setFooter({ text: "Jahmunkey Image Management System" })
      .setTimestamp();

    await interaction.reply({ embeds: [pingEmbed] });
  }
});

// ---------------- EXPRESS REDIRECT SERVER ----------------
const app = express();

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>System Status | Vax Images</title>
        <style>
            body { background-color: #0f111a; color: #ffffff; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .card { background-color: #1a1c29; padding: 2.5rem; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.3); text-align: center; border: 1px solid #2d3142; max-width: 400px; width: 100%; }
            .status-icon { font-size: 3.5rem; margin-bottom: 1rem; animation: pulse 2s infinite; }
            h1 { margin: 0 0 0.5rem 0; font-size: 1.8rem; }
            p { color: #8b92b6; margin: 0 0 1.5rem 0; }
            .badge { background-color: #05c46b; color: #ffffff; padding: 0.5rem 1rem; border-radius: 20px; font-weight: 600; display: inline-block; }
            @keyframes pulse { 0% { transform: scale(1); } 50% { transform: scale(1.05); } 100% { transform: scale(1); } }
        </style>
    </head>
    <body>
        <div class="card">
            <div class="status-icon">🐒</div>
            <h1>Jahmunkey Image Service</h1>
            <p>Your private image/video redirect engine is operational.</p>
            <div class="badge">● Bot Online</div>
        </div>
    </body>
    </html>
  `);
});

app.get("/health", (req, res) => res.status(200).send("OK"));

app.get("/:id", async (req, res) => {
  const id = req.params.id;
  const url = `https://api.github.com/repos/${process.env.GITHUB_REPO}/contents/images`;
  const headers = {
    Authorization: `token ${process.env.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  };

  try {
    const response = await axios.get(url, { headers });
    const targetFile = response.data.find(file => file.name.startsWith(id));

    if (targetFile) {
      const rawUrl = `https://raw.githubusercontent.com/${process.env.GITHUB_REPO}/main/images/${targetFile.name}`;
      return res.redirect(rawUrl);
    }
    res.status(404).send("Asset file not found.");
  } catch (error) {
    res.status(500).send("Internal Redirect Engine Routing Error.");
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log(`Express Redirect Server running on port ${PORT}`);
  await registerSlashCommands();
  client.login(process.env.DISCORD_TOKEN);
});