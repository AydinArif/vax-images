const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const express = require("express");
const { nanoid } = require("nanoid");
require("dotenv").config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const GITHUB_API = "https://api.github.com";

// ---------------- UPLOAD FUNCTION ----------------
async function uploadToGitHub(buffer, id) {
  const path = `images/${id}.png`;

  await axios.put(
    `${GITHUB_API}/repos/${process.env.GITHUB_REPO}/contents/${path}`,
    {
      message: `upload ${id}`,
      content: buffer.toString("base64"),
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

// ---------------- DISCORD ----------------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "convert") {
    const file = interaction.options.getAttachment("image");

    await interaction.reply("Uploading...");

    try {
      const res = await axios.get(file.url, {
        responseType: "arraybuffer",
      });

      const id = nanoid(8);

      await uploadToGitHub(Buffer.from(res.data), id);

      const url = `${process.env.BASE_URL}/${id}`;

      await interaction.editReply(`✅ Uploaded: ${url}`);
    } catch (err) {
      console.error(err);
      await interaction.editReply("❌ Upload failed");
    }
  }
});

// ---------------- LINK SERVER ----------------
const app = express();

app.get("/:id", (req, res) => {
  const id = req.params.id;

  const rawUrl = `https://raw.githubusercontent.com/${
    process.env.GITHUB_REPO
  }/main/images/${id}.png`;

  res.redirect(rawUrl);
});

app.listen(process.env.PORT, () => {
  console.log("Server running");
});

client.login(process.env.DISCORD_TOKEN);