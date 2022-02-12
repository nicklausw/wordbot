import "reflect-metadata";
import { TextBasedChannel, Intents, Interaction, Message, StringMappedInteractionTypes } from "discord.js";
import { Client } from "discordx";
import { dirname, importx } from "@discordx/importer";
import { Koa } from "@discordx/koa";
import * as MySQL from "mysql";
import v from "voca";
import util from "util";

var con = MySQL.createConnection({
  host: "127.0.0.1",
  user: "root",
  password: process.env.SQL_PASS
});

const query = util.promisify(con.query).bind(con);

async function resolveName(s: string, db: string, message: Message): Promise<string> {
  s = v.trim(s, "<@!>");
  if(s.length == 17 || s.length == 18) {
    if(parseInt(s) != NaN) {
      // it's a numeric ID already, just return it.
      return s;
    }
  }
  const results: any = await query({sql: "select id from " + db + " where name=\'" + s + "\';"});
  try {
    s = results[0]["id"];
  } catch {
    // no one by that name.
    message.reply("I don't know anyone by that name.");
    return "";
  }
  return s;
}

function sqlstring(s: string): string {
  s = v.trim(s, "\'").replace("\'", "\'\'").toLowerCase();
  const allowedSymbols = "abcdefghijklmnopqrstuvwxyz\'";
  var newstring = "";
  for(var c = 0; c < s.length; c++) {
    if(allowedSymbols.includes(s[c])) {
      newstring += s[c];
    }
  }
  return newstring;
}

async function handleWord(thisword: string, wordTable: string, serverSchema: string) {
    var word = sqlstring(thisword);
    if(word.length > 50 || word === "") {
      return;
    }
    const usesQuery: any = await query({sql: "select uses from " + serverSchema + wordTable + " where word=\'" + word + "\';"});
    var uses: Number = 1;
    try {
      uses = usesQuery[0]["uses"] + 1;
    } catch { }

    await query({sql: "insert into " + serverSchema + wordTable + " (word, uses) values (" + "\'" + word + "\', " + uses + ") on duplicate key update uses = " + uses + ";"});
}

async function handleMessage(message: Message, runCommands: boolean) {
  var wordArray: Array<string>;
  var serverSchema: string = "s" + message.guild!.id + ".";

  if(runCommands) console.log("processing message from " + message.author.id + "...");

  if(message.content.toLowerCase().startsWith("indexchannels ") && runCommands) {
    if(message.author.id !== "223609896086667264") {
      message.reply("only Nick can do that.");
      return;
    }
    for(var c = 0; c < message.mentions.channels.size; c++) {
      var channel : TextBasedChannel = message.mentions.channels.get(message.mentions.channels.keyAt(c)!)!;
      console.log("indexing " + channel.id + "...");
      var messageList = new Array<Message<boolean>>();
      const messages = await channel.messages.fetch();
      messages.forEach(thisMessage => {
        messageList.push(thisMessage);
      })
      do {
        await newMessage(messageList[0], false);
        messageList.shift();
      } while(messageList[0] !== undefined);
      console.log("indexed " + channel.id + ".");
    }
    console.log("processed message from " + message.author.id + ".");
    return;
  }

  if(message.content.toLowerCase().startsWith("favoriteword ") && runCommands) {
    var person: string = await resolveName(v.trim(message.content.toLowerCase().split("favoriteword ")[1], "<@!>"), serverSchema + "nicknames", message);
    if(person === "") return;
    if(person === undefined) {
      message.reply("format: favoriteword (@ person)");
      return;
    }
    var thisWordTable: string = serverSchema + "u" + person;
    var tempTable: string = serverSchema + "temp_table_" + Math.round(Math.random() * 10000);
    try {
      await query({sql: "create table " + tempTable + " as select * from " + thisWordTable + " where length(word) > 5;"});
      const results: any = await query({sql: "select * from " + tempTable + " where uses = (select max(uses) from " + tempTable + ");"});
      var uses = 0;
      var words = new Array<string>();
      results.forEach(e => {
        words.push(e["word"]);
        uses = e["uses"];
      });
      if(words.length === 0) {
        message.reply("No words found. Lurk less.");
      } else if(words.length === 1) {
        message.reply("Favorite word is " + words[0] + " with " + uses + " use" + (uses > 1 ? "s" : "") + ".");
      } else {
        var response: string = "Favorite words are ";
        for(var c = 0; c < words.length; c++) {
          response += words[c];
          if(c === words.length - 2) response += " and "
          else if(c !== words.length - 1) response += ", "
        }
        response += " with " + uses + " uses.";
        message.reply(response);
      }
    } catch (error) {
      message.reply("came up empty on that one.");
      return;
    }
    await query({sql: "drop table " + tempTable + ";"});
    return;
  }

  if(message.content.toLowerCase().startsWith("wordcount ") && runCommands) {
    var parameters: Array<string> = message.content.toLowerCase().split(" ");
    if(parameters.length != 3) {
      message.reply("format: wordcount (@ person) (single word)");
      return;
    }
    var person: string = await resolveName(parameters[1], serverSchema + "nicknames", message);
    if(person === "") return;
    var word: string = parameters[2].replace("\'", "\'\'");
    var thisWordTable: string = serverSchema + "u" + person;
    try {
      const results: any = await query({sql: "select * from " + thisWordTable + " where word = \'" + word + "\';"});
      var uses: number = results[0]["uses"];
      message.reply("User has said \"" + word + "\" " + uses + " time" + (uses > 1 ? "s" : "") + ".");
    } catch {
      message.reply("came up empty on that one.");
    }
    return;
  }

  if(message.content.toLowerCase().startsWith("totalwordcount ") && runCommands) {
    var parameters: Array<string> = message.content.toLowerCase().split(" ");
    if(parameters.length != 2) {
      message.reply("format: totalwordcount (@ person)");
      return;
    }
    var person: string = await resolveName(parameters[1], serverSchema + "nicknames", message);
    if(person === "") return;
    var thisWordTable: string = serverSchema + "u" + person;
    try {
      const results: any = await query({sql: "select sum(uses) from " + thisWordTable + ";"});
      var sum: number = results[0]["sum(uses)"];
      message.reply("User has said " + sum + " words that I've counted.");
    } catch {
      message.reply("user hasn't said anything.");
    }
    return;
  }

  if(message.content.toLowerCase().startsWith("vocabsize ") && runCommands) {
    var parameters: Array<string> = message.content.toLowerCase().split(" ");
    if(parameters.length != 2) {
      message.reply("format: vocabsize (@ person)");
      return;
    }
    var person: string = await resolveName(parameters[1], serverSchema + "nicknames", message);
    if(person === "") return;
    var thisWordTable: string = serverSchema + "u" + person;
    try {
      const results: any = await query({sql: "select count(*) from " + thisWordTable + ";"});
      var count = results[0]["count(*)"];
      message.reply("User has said " + count + " words.");
    } catch {
      message.reply("USer hasn't said anything.");
    }
    return;
  }

  if(message.content.toLowerCase().startsWith("addname ") && runCommands) {
    var parameters: Array<string> = message.content.toLowerCase().split(" ");
    if(parameters.length != 3) {
      message.reply("format: addname (@ person) (single word)");
      return;
    }
    var person: string = await resolveName(parameters[1], serverSchema + "nicknames", message);
    if(person === "") return;
    var nickname: string = parameters[2].replace("\'", "\'\'");
    var thisNameTable: string = serverSchema + "nicknames";

    if(nickname.toLowerCase() !== sqlstring(nickname)) {
      message.reply("nicknames can only have letters and apostrophes.");
      return;
    }
    nickname = sqlstring(nickname);

    if(nickname.length > 50) {
      message.reply("nicknames can't be longer than 50 characters.");
      return;
    }

    try {
      await query({sql: "insert into " + thisNameTable + " (name, id) values (" + "\'" + nickname + "\', " + person + ") on duplicate key update id = " + person + ";"});
    } catch (error) {
      throw error;
    }
    return;
  }

  var wordTable: string = "u" + message.author.id;

  // make tables for user
  await query({sql: "insert into " + serverSchema + "users (id) select \'" + message.author.id + "\' from dual where not exists (select id from " + serverSchema + "users where id=\'" + message.author.id + "\');"});
  await query({sql: "create table if not exists " + serverSchema + wordTable + "(word varchar(50), uses bigint, primary key(word));"});

  var words: Array<string> = message.content.trim().replace("\n", " ").split(" ");
  do {
    await handleWord(words[0], wordTable, serverSchema);
    words.shift();
  } while(words[0] !== undefined)

  if(runCommands) console.log("processed message from " + message.author.id + ".");
}

async function newMessage(message: Message, runCommands: boolean) {
  await query({sql: "create schema if not exists s" + message.guild!.id + ";"});
  await query({sql: "create table if not exists s" + message.guild!.id + ".users(id varchar(50));"});
  await query({sql: "create table if not exists s" + message.guild!.id + ".nicknames(name varchar(50), id varchar(50), primary key(name));"});
  await handleMessage(message, runCommands);
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

  console.log("MySQL started");
});

client.on("interactionCreate", (interaction: Interaction) => {
  client.executeInteraction(interaction);
});

client.on("messageCreate", (message: Message) => {
  if(message.author.id === client.user!.id) return;

  newMessage(message, true);
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
