const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const axios = require("axios");
const express = require("express");
const { nanoid } = require("nanoid");
require("dotenv").config();

const bootTime = Date.now();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
});

// Initialize S3 Client configured explicitly for Cloudflare R2
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

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

// ---------------- DISCORD BOT LOGIC ----------------

async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("delete")
      .setDescription("Delete a file from your database using its ID")
      .setContexts([0, 1, 2])
      .addStringOption(option =>
        option.setName("id").setDescription("The character ID code of the file").setRequired(true)
      )
      .toJSON(),

    new SlashCommandBuilder()
      .setName("list")
      .setDescription("Show total media counts and active IDs inside your database")
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

// ─── MAIN TEXT PIPELINE (Handles All Images, Gifs, and Raw Heavy Videos) ───
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content.toLowerCase().startsWith("vax upload")) {
    const file = message.attachments.first();

    if (!file) {
      return message.reply("❌ You need to attach a media file alongside the command!");
    }

    const msgReply = await message.reply("⏳ **Processing file payload buffer and streaming cleanly to Cloudflare R2...**");

    try {
      const res = await axios.get(file.url, { responseType: "arraybuffer" });
      const buffer = Buffer.from(res.data);
      
      const shortId = nanoid(8);
      const ext = file.name.split('.').pop().toLowerCase();
      const filename = `${shortId}.${ext}`;
      const isVideoFile = ["mp4", "mov", "webm", "avi", "mkv"].includes(ext);

      // Direct cloud buffer upload
      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: filename,
          Body: buffer,
          ContentType: file.contentType,
        })
      );

      const url = `${process.env.BASE_URL}/${shortId}`;

      const successEmbed = new EmbedBuilder()
        .setColor("#2ECC71")
        .setTitle(`📦 Cloud Transfer Complete!`)
        .setDescription(`Your asset has been hosted permanently via text routing pipeline.`)
        .addFields(
          { name: "🔗 Short URL", value: `\`${url}\`\n[Open Link](${url})`, inline: false },
          { name: "🆔 File ID", value: `\`${shortId}\` (\`.${ext}\`)`, inline: true }
        )
        .setTimestamp();

      if (isVideoFile) {
        await msgReply.edit({ embeds: [successEmbed], content: `🎥 **Video Player Preview:**\n${url}` });
      } else {
        await msgReply.edit({ embeds: [successEmbed], content: null });
      }
    } catch (e) {
      console.error(e);
      await msgReply.edit({ content: "❌ **Upload Failed:** Cloud transaction error or connection timeout.", embeds: [] });
    }
  }
});

// ─── UTILITY INTERACTION INTERFACES ───
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // HANDLE DELETE COMMAND
  if (interaction.commandName === "delete") {
    const id = interaction.options.getString("id").trim();
    const processingEmbed = new EmbedBuilder()
      .setColor("#5865F2")
      .setDescription(`⏳ **Scanning cloud architecture to purge asset reference \`${id}\`...**`);

    await interaction.reply({ embeds: [processingEmbed] });

    try {
      const listRes = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME }));
      const targetFile = listRes.Contents?.find(item => item.Key.startsWith(id));

      if (!targetFile) throw new Error("File not found");

      await s3.send(
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: targetFile.Key,
        })
      );

      const deleteEmbed = new EmbedBuilder()
        .setColor("#E67E22")
        .setTitle("🗑️ Media Deleted")
        .setDescription(`The asset file associated with ID \`${id}\` has been scrubbed from your R2 cloud bucket.`)
        .setTimestamp();

      await interaction.editReply({ embeds: [deleteEmbed] });
    } catch (e) {
      console.error(e);
      const errorEmbed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle("❌ Deletion Failed")
        .setDescription(`Could not find or delete a file with the ID reference \`${id}\` from the cloud storage bucket.`);
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }

  // HANDLE LIST COMMAND
  if (interaction.commandName === "list") {
    const loadingEmbed = new EmbedBuilder()
      .setColor("#5865F2")
      .setDescription("⏳ **Fetching media indexing tables from Cloudflare R2...**");

    await interaction.reply({ embeds: [loadingEmbed] });

    try {
      const listRes = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME }));
      const items = listRes.Contents || [];

      if (items.length === 0) {
        const emptyEmbed = new EmbedBuilder()
          .setColor("#95A5A6")
          .setTitle("📁 Database Empty")
          .setDescription("There are currently no active media assets inside your cloud storage bucket.")
          .setTimestamp();
        return await interaction.editReply({ embeds: [emptyEmbed] });
      }

      const idList = items.map((item, index) => {
        const cleanId = item.Key.split('.')[0];
        const ext = item.Key.split('.').pop();
        const icon = ["mp4", "mov", "webm", "avi", "mkv"].includes(ext.toLowerCase()) ? "🎥" : "🖼️";
        return `\`${index + 1}.\` ${icon} **${cleanId}** (\`.${ext}\`) ([Link](${process.env.BASE_URL}/${cleanId}))`;
      }).join("\n");

      const trimmedList = idList.length > 3800 ? idList.substring(0, 3800) + "\n*...and more files*" : idList;

      const listEmbed = new EmbedBuilder()
        .setColor("#3498DB")
        .setTitle("📊 Database Overview")
        .setDescription(`### Total Media: \`${items.length}\`\n\n${trimmedList}`)
        .setTimestamp();

      await interaction.editReply({ embeds: [listEmbed] });
    } catch (e) {
      console.error(e);
      const errorEmbed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle("❌ Fetch Failed")
        .setDescription("Failed to securely connect and fetch system catalog indexes from the R2 endpoint.");
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
      .setFooter({ text: "Jahmunkey Storage Engine" })
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
            <p>Your private R2 cloud-linked redirect engine is operational.</p>
            <div class="badge">● Bot Online</div>
        </div>
    </body>
    </html>
  `);
});

app.get("/health", (req, res) => res.status(200).send("OK"));

app.get("/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const listRes = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME }));
    const targetFile = listRes.Contents?.find(item => item.Key.startsWith(id));

    if (targetFile) {
      const publicCdnUrl = `${process.env.R2_CDN_URL}/${targetFile.Key}`;
      return res.redirect(publicCdnUrl);
    }
    res.status(404).send("Asset file not found.");
  } catch (error) {
    res.status(500).send("Internal Cloud Router Routing Error.");
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
  console.log(`Express Redirect Server running on port ${PORT}`);
  await registerSlashCommands();
  client.login(process.env.DISCORD_TOKEN);
});