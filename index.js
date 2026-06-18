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
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [1] 
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
      return message.reply("<:wrong:1517029715972460605> You need to attach a media file alongside the command!");
    }

    const msgReply = await message.reply("<:vax_timer:1517030316022431804> **Uploading your media to our database...**");

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
        .setTitle(`✔ Upload Complete!`)
        .setDescription(`Your media has been uploaded to the database successfully.`)
        .addFields(
          { name: "<:vax_link:1517032708713222236> Media URL", value: `\`${url}\`\n[Link](${url})`, inline: false },
          { name: "<:vax_id:1517032674030780537> File ID", value: `\`${shortId}\` (\`.${ext}\`)`, inline: true }
        )
        .setTimestamp();

      if (isVideoFile) {
        await msgReply.edit({ embeds: [successEmbed], content: `<:vax_vid:1517027665859837982> **Video Player Preview:**\n${url}` });
      } else {
        await msgReply.edit({ embeds: [successEmbed], content: null });
      }
    } catch (e) {
      console.error(e);
      await msgReply.edit({ content: "<:wrong:1517029715972460605> **Upload Failed:** Database error or connection timeout.", embeds: [] });
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
      .setDescription(`<:vax_timer:1517030316022431804> **Scanning database \`${id}\`...**`);

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
        .setTitle("✔ Media Deleted")
        .setDescription(`The asset file associated with ID \`${id}\` has been removed from your database`)
        .setTimestamp();

      await interaction.editReply({ embeds: [deleteEmbed] });
    } catch (e) {
      console.error(e);
      const errorEmbed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle("<:wrong:1517029715972460605> Deletion Failed")
        .setDescription(`Could not find or delete a file with the ID reference \`${id}\` from the database.`);
      await interaction.editReply({ embeds: [errorEmbed] });
    }
  }

  // HANDLE LIST COMMAND
  if (interaction.commandName === "list") {
    const loadingEmbed = new EmbedBuilder()
      .setColor("#5865F2")
      .setDescription("<:vax_timer:1517030316022431804> **Fetching media from database...**");

    await interaction.reply({ embeds: [loadingEmbed] });

    try {
      const listRes = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME }));
      const items = listRes.Contents || [];

      if (items.length === 0) {
        const emptyEmbed = new EmbedBuilder()
          .setColor("#95A5A6")
          .setTitle("<:vax_folder:1517031525135421480> Database Empty")
          .setDescription("There are currently no media in your database.")
          .setTimestamp();
        return await interaction.editReply({ embeds: [emptyEmbed] });
      }

      const idList = items.map((item, index) => {
        const cleanId = item.Key.split('.')[0];
        const ext = item.Key.split('.').pop();
        const icon = ["mp4", "mov", "webm", "avi", "mkv"].includes(ext.toLowerCase()) ? "<:vax_vid:1517027665859837982>" : "<:vax_img:1517027805228040292>";
        return `\`${index + 1}.\` ${icon} **${cleanId}** (\`.${ext}\`) ([Link](${process.env.BASE_URL}/${cleanId}))`;
      }).join("\n");

      const trimmedList = idList.length > 3800 ? idList.substring(0, 3800) + "\n*...and more files*" : idList;

      const listEmbed = new EmbedBuilder()
        .setColor("#3498DB")
        .setTitle("📊 Database details")
        .setDescription(`### Total Media: \`${items.length}\`\n\n${trimmedList}`)
        .setTimestamp();

      await interaction.editReply({ embeds: [listEmbed] });
    } catch (e) {
      console.error(e);
      const errorEmbed = new EmbedBuilder()
        .setColor("#E74C3C")
        .setTitle("<:wrong:1517029715972460605> Fetch Failed")
        .setDescription("Failed to fetch items from database.");
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
        { name: "Connection", value: "🟢 Online", inline: true },
        { name: "Latency", value: `📡 ${latency}ms`, inline: true },
        { name: "Uptime", value: `<:vax_timer:1517030316022431804> ${uptime}`, inline: false }
      )
      .setFooter({ text: "Jahmunkey Database" })
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
            <p>Your cloudfare R2 image/video bot is fully functional</p>
            <div class="badge">● Bot Online</div>
        </div>
    </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Health Check | Jahmunkey</title>
        <style>
            body { background-color: #0f111a; color: #ffffff; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
            .health-card { background-color: #1a1c29; padding: 2rem; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); text-align: center; border: 1px solid #2d3142; max-width: 350px; width: 100%; }
            .pulse-dot { width: 12px; height: 12px; background-color: #05c46b; border-radius: 50%; display: inline-block; margin-right: 8px; box-shadow: 0 0 12px #05c46b; animation: emit 1.5s infinite ease-in-out; }
            .status-container { display: flex; align-items: center; justify-content: center; background-color: #11131e; border: 1px solid #25283a; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600; color: #05c46b; font-size: 1.1rem; letter-spacing: 0.5px; }
            h2 { margin: 0 0 1rem 0; font-size: 1.4rem; color: #ffffff; font-weight: 500; }
            @keyframes emit { 0% { transform: scale(0.9); opacity: 0.6; } 50% { transform: scale(1.1); opacity: 1; box-shadow: 0 0 18px #05c46b; } 100% { transform: scale(0.9); opacity: 0.6; } }
        </style>
    </head>
    <body>
        <div class="health-card">
            <h2>System Engine Vital</h2>
            <div class="status-container">
                <span class="pulse-dot"></span>
                <span>STATUS: OK</span>
            </div>
        </div>
    </body>
    </html>
  `);
});

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