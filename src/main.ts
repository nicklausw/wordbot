import "reflect-metadata";
import { Intents, Interaction, Message } from "discord.js";
import { Client } from "discordx";
import { dirname, importx } from "@discordx/importer";
import { Koa } from "@discordx/koa";
import * as MySQL from "mysql";
import v from "voca";

var con = MySQL.createConnection({
  host: "127.0.0.1",
  user: "root",
  password: process.env.SQL_PASS
});

function query({ sql = "", params = Object.create(null) }) {
  return new Promise((resolve, reject) => {
    console.log(sql);
    con.query(
      sql,
      params,
      (err, results: any, fields) => {
        if (err) { reject(err); } else { resolve({ results, fields }); }
      },
    );
  });
}
function handleWord(words: Array<string>, wordTable: string, serverSchema: string) {
    var word = v.trim(words[0].replace("\'", "\'\'"), " .,?!<>@#[]();:").toLowerCase();
    query({sql: "select uses from " + serverSchema + "." + wordTable + " where word=\'" + word + "\';"}).then(results => {
      var uses: Number = 1;
      //@ts-ignore
      if(results !== undefined) {
        // @ts-ignore
        if(results["results"][0] !== undefined) {
          // @ts-ignore
          uses = JSON.parse(JSON.stringify(results["results"][0]["uses"])) + 1;
        }
      }
      query({sql: "insert into " + serverSchema + "." + wordTable + " (word, uses) values (" + "\'" + word + "\', " + uses + ") on duplicate key update uses = " + uses + ";"}).then(results => {
        words.shift();
        if(words[0] !== undefined)
          handleWord(words, wordTable, serverSchema);
        else
          console.log("handled message.");
      });
    });
}

export const client = new Client({
 simpleCommand: {
    prefix: "!",
  },
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.GUILD_VOICE_STATES,
  ],
  // If you only want to use global commands only, comment this line
  botGuilds: [(client) => client.guilds.cache.map((guild) => guild.id)],
});

client.once("ready", async () => {
  // make sure all guilds are in cache
  await client.guilds.fetch();

  // init all application commands
  await client.initApplicationCommands({
    guild: { log: true },
    global: { log: true },
  });

  // init permissions; enabled log to see changes
  await client.initApplicationPermissions(true);

  // uncomment this line to clear all guild commands,
  // useful when moving to global commands from guild commands
  //  await client.clearApplicationCommands(
  //    ...client.guilds.cache.map((g) => g.id)
  //  );

  console.log("Bot started");

  con.connect(function(err: any) {
    if (err) throw err;
  });
  
  client.guilds.cache.forEach(guild => {
    query({sql: "create schema if not exists s" + guild.id + ";"}).then(x => {
      query({sql: "create table if not exists s" + guild.id + ".users(id varchar(50));"});
    });
  })
  console.log("MySQL started");
});

client.on("interactionCreate", (interaction: Interaction) => {
  client.executeInteraction(interaction);
});

client.on("messageCreate", (message: Message) => {
  if(message.author.id === client.user!.id) return;
  
  console.log("received message from " + message.author.id + "...");

  var wordArray: Array<string>;
  var serverSchema: string = "s" + message.guild!.id;

  if(message.content.toLowerCase().startsWith("favoriteword ")) {
    var person: string = v.trim(message.content.toLowerCase().split("favoriteword ")[1], "<@!>");
    if(person === undefined) {
      message.reply("format: favoriteword (@ person)");
      return;
    }
    var thisWordTable: string = "u" + person + "_words";
    query({sql: "select * from " + serverSchema + "." + thisWordTable + " where uses = (select max(uses) from " + serverSchema + "." + thisWordTable + ");"}).then(results => {
      //@ts-ignore
      var uses: number = JSON.parse(JSON.stringify(results["results"][0]["uses"]));
      //@ts-ignore
      var word: string = JSON.parse(JSON.stringify(results["results"][0]["word"]));
      message.reply("Favorite word is " + word + " with " + uses + " uses.");
    }).catch((error) => {
      //if(error.code === "ER_NO_SUCH_TABLE") {
        message.reply("No messages from that person.");
      //}
    })
    return;
  }

  if(message.content.toLowerCase().startsWith("wordcount ")) {
    var parameters: Array<string> = message.content.toLowerCase().split(" ");
    if(parameters.length != 3) {
      message.reply("format: wordcount (@ person) (single word)");
      return;
    }
    var person: string = v.trim(parameters[1], "<@!>");
    var word: string = parameters[2].replace("\'", "\'\'");
    var thisWordTable: string = "u" + person + "_words";
    query({sql: "select * from " + serverSchema + "." + thisWordTable + " where word = \'" + word + "\';"}).then(results => {
      //@ts-ignore
      var uses: number = JSON.parse(JSON.stringify(results["results"][0]["uses"]));
      message.reply("User has said \"" + word + "\" " + uses + " times.");
    }).catch((error) => {
        message.reply("That person hasn't used that word.");
    });
    return;
  }

  var nameTable: string = "u" + message.author.id + "_nicknames";
  var wordTable: string = "u" + message.author.id + "_words";

  // make tables for user
  query({sql: "insert into " + serverSchema + "." + "users (id) select \'" + message.author.id + "\' from dual where not exists (select id from " + serverSchema + "." + "users where id=\'" + message.author.id + "\');"});
  query({sql: "create table if not exists " + serverSchema + "." + wordTable + "(word varchar(50), uses bigint, primary key(word));"});
  query({sql: "create table if not exists " + serverSchema + "." + nameTable + "(word varchar(50), uses bigint);"});

  var words: Array<string> = message.content.trim().split(" ");
  handleWord(words, wordTable, serverSchema);
});

async function run() {
  // with cjs
  // await importx(__dirname + "/{events,commands}/**/*.{ts,js}");
  // with ems
  await importx(
    dirname(import.meta.url) + "/{events,commands,api}/**/*.{ts,js}"
  );

  // let's start the bot
  if (!process.env.BITCHBOT_TOKEN) {
    throw Error("Could not find BITCHBOT_TOKEN in your environment");
  }
  await client.login(process.env.BITCHBOT_TOKEN); // provide your bot token

  // ************* rest api section: start **********

  // api: preare server
  const server = new Koa();

  // api: need to build the api server first
  await server.build();

  // api: let's start the server now
  const port = process.env.PORT ?? 3000;
  server.listen(port, () => {
    console.log(`discord api server started on ${port}`);
    console.log(`visit localhost:${port}/guilds`);
  });

  // ************* rest api section: end **********
}

run();
