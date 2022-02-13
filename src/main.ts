import "reflect-metadata";
import { TextBasedChannel, Intents, Interaction, Message, MessageEmbed } from "discord.js";
import { Client } from "discordx";
import { dirname, importx } from "@discordx/importer";
import { Koa } from "@discordx/koa";
import { exec } from "child_process";
import * as MySQL from "mysql";
import v from "voca";
import util from "util";

var dataChanged = false;

var con = MySQL.createConnection({
  host: "127.0.0.1",
  user: "root",
  password: process.env.SQL_PASS
});

// promise to get the query output.
function query(sql = "", params = Object.create(null)) {
  return new Promise((resolve, reject) => {
    console.log(sql);
    con.query(
      sql,
      params,
      (err, results: any) => {
        if (err) { reject(err); } else { resolve({ results }); }
      },
    );
  });
}

// note: the output of queryForResult() and queryForResults() depends on how many
// selected columns are in your query (how long the selections array is).
// if it's only one, you can access the output purely.
// queryForResult() gives output, queryForResults() gives output[0] and output[1] and so on.
// otherwise, if you passed ["word", "uses"] you'd access them like
// output.word and output.uses, or output[0].word and output[0].uses for queryForResults.

async function queryForResults(thisQuery: string, selections: Array<string>): Promise<any> {
  var result: any = await query(thisQuery);
  var out = new Array<any>();
  for(var c = 0; c < Object.keys(result["results"]).length; c++) {
    var thisSet = new Array<any>();
    for(var d = 0; d < selections.length; d++) {
      if(selections.length === 1) {
        thisSet[c] = result["results"][c][selections[d]];
      } else {
        thisSet[selections[d]] = result["results"][c][selections[d]];
      }
    }
    if(selections.length === 1) {
      out.push(thisSet[c]);
    } else {
      out.push(thisSet);
    }
  }
  return out;
}

async function queryForResult(thisQuery: string, selections: Array<string>, index = 0): Promise<any> {
  var result: any = await query(thisQuery);
  if(selections.length === 1) {
    return result["results"][index][selections[0]];
  } else {
    var out = {};
    for(var c = 0; c < selections.length; c++) {
      out[selections[c]] = result["results"][index][selections[c]];
    }
  }
}

function helpMessage(message: Message) {
  const helpEmbed = new MessageEmbed()
	.setTitle('bitchbot')
	.setDescription('fully case-insensitive.')
	.addFields(
		{ name: "favoriteword (person)", value: "gets person's most used word." },
		{ name: "wordcount (person) (word)", value: "gets number of times person has used word." },
		{ name: "totalwordcount (person)", value: "gets number of words person has used in total" },
    { name: "serverwordcount (word)", value: "gets number of times anyone in server has used word." },
    { name: "servertotalwordcount", value: "gets total number of words used in server." },
    { name: "vocabsize (person)", value: "gets number of unique words person has used" },
    { name: "servervocabsize", value: "gets number of unique words server has used" },
    { name: "addname (person) (name)", value: "add an alias to avoid mentioning someone repeatedly." }
	);

  message.reply({embeds: [helpEmbed]});
}

// get a nickname, or return a numerical ID.
async function resolveName(s: string, db: string, message: Message): Promise<string> {
  s = v.trim(s, "<@!>");
  if(s.length == 17 || s.length == 18) {
    if(parseInt(s) != NaN) {
      // it's a numeric ID already, just return it.
      return s;
    }
  }
  try {
    s = await queryForResult("select id from " + db + " where name=\'" + s + "\';", ["id"]);
  } catch {
    // no one by that name.
    message.reply("I don't know anyone by that name.");
    return "";
  }
  return s;
}

// make a string SQL-friendly.
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

async function getWordCount(user: string, word: string, wordTable: string): Promise<number> {
  try {
    return await queryForResult("select sum(uses) from " + wordTable + " where word like \'%" + word + "%\';", ["sum(uses)"]);
  } catch {
    return 0;
  }
}

async function handleWord(thisword: string, wordTable: string, serverSchema: string) {
    var word = sqlstring(thisword);
    if(word.length > 50 || word === "") {
      return;
    }
    var uses: Number = 1;
    try {
      uses = await queryForResult("select uses from " + serverSchema + wordTable + " where word=\'" + word + "\';", ["uses"]) + 1;
    } catch { }

    await query("insert into " + serverSchema + wordTable + " (word, uses) values (" + "\'" + word + "\', " + uses + ") on duplicate key update uses = " + uses + ";");
    dataChanged = true;
}

async function handleMessage(message: Message, runCommands: boolean) {
  var wordArray: Array<string>;
  var serverSchema: string = "s" + message.guild!.id + ".";

  if(runCommands) console.log("processing message from " + message.author.id + "...");

  if(message.content.toLowerCase().startsWith("indexchannels") && runCommands) {
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

  if(message.content.toLowerCase().startsWith("favoriteword") && runCommands) {
    var parameters: Array<string> = message.content.toLowerCase().split(" ");
    if(parameters.length != 2) {
      helpMessage(message);
      return;
    }
    var person: string = await resolveName(parameters[1], serverSchema + "nicknames", message);
    if(person === "") return;
    var thisWordTable: string = serverSchema + "u" + person;
    try {
      var maxUses = await queryForResult("select max(uses) from " + thisWordTable + " where length(word) > 5;", ["max(uses)"]);
      var results: any = await queryForResults("select * from " + thisWordTable + " where uses = " + maxUses + " and length(word) > 5;", ["word", "uses"]);
      var uses = 0;
      var words = new Array<string>();
      for(var c = 0; c < results.length; c++) {
        console.log("pushing the word " + results[c].word + " with " + results[c].uses + " uses.");
        words.push(results[c].word);
        uses = results[c].uses;
      }
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
      throw error;
      message.reply("came up empty on that one.");
      return;
    }
    return;
  }

  if(message.content.toLowerCase().startsWith("wordcount") && runCommands) {
    var parameters: Array<string> = message.content.toLowerCase().split(" ");
    if(parameters.length != 3) {
      helpMessage(message);
      return;
    }
    var person: string = await resolveName(parameters[1], serverSchema + "nicknames", message);
    if(person === "") return;
    var word: string = parameters[2].replace("\'", "\'\'");
    var thisWordTable: string = serverSchema + "u" + person;
    var count = await getWordCount(person, word, thisWordTable);
    if(count > 0) {
      message.reply("User has said \"" + word + "\" " + count + " time" + (count > 1 ? "s" : "") + ".");
    } else {
      message.reply("came up empty on that one.");
    }
    return;
  }

  if(message.content.toLowerCase().startsWith("serverwordcount") && runCommands) {
    var parameters: Array<string> = message.content.toLowerCase().split(" ");
    if(parameters.length != 2) {
      helpMessage(message);
      return;
    }
    var word: string = parameters[1].replace("\'", "\'\'");

    var userCount: number;
    var totalWordCount = 0;

    userCount = await queryForResult("select count(*) from " + serverSchema + "users;", ["count(*)"]);
    for(var c = 0; c < userCount; c++) {
      var thisCount = await queryForResult("select * from " + serverSchema + "users;", ["id"], c);
      totalWordCount += await getWordCount(thisCount, word, serverSchema + "u" + thisCount);
    }
    if(totalWordCount > 0) {
      message.reply("Server has said " + word + " " + totalWordCount + " times.");
    } else {
      message.reply("Server hasn't said that word.");
    }
    return;
  }

  if(message.content.toLowerCase().startsWith("totalwordcount") && runCommands) {
    var parameters: Array<string> = message.content.toLowerCase().split(" ");
    if(parameters.length != 2) {
      helpMessage(message);
      return;
    }
    var person: string = await resolveName(parameters[1], serverSchema + "nicknames", message);
    if(person === "") return;
    var thisWordTable: string = serverSchema + "u" + person;
    try {
      var sum: number = await queryForResult("select sum(uses) from " + thisWordTable + ";", ["sum(uses)"]);
      message.reply("User has said " + sum + " words that I've counted.");
    } catch {
      message.reply("user hasn't said anything.");
    }
    return;
  }

  if(message.content.toLowerCase() == "servertotalwordcount" && runCommands) {
    var userCount: number;
    var totalWordCount = 0;

    userCount = await queryForResult("select count(*) from " + serverSchema + "users;", ["count(*)"]);
    for(var c = 0; c < userCount; c++) {
      var thisWordTable: string = serverSchema + "u" + await queryForResult("select * from " + serverSchema + "users;", ["id"], c);
      var sum: number = await queryForResult("select sum(uses) from " + thisWordTable + ";", ["sum(uses)"]);
      totalWordCount += sum;
    }
    if(totalWordCount > 0) {
      message.reply("Server has said " + totalWordCount + " total words.");
    } else {
      message.reply("Server hasn't said that word.");
    }
    return;
  }

  if(message.content.toLowerCase().startsWith("vocabsize") && runCommands) {
    var parameters: Array<string> = message.content.toLowerCase().split(" ");
    if(parameters.length != 2) {
      helpMessage(message);
      return;
    }
    var person: string = await resolveName(parameters[1], serverSchema + "nicknames", message);
    if(person === "") return;
    var thisWordTable: string = serverSchema + "u" + person;
    try {
      var count: number = await queryForResult("select count(*) from " + thisWordTable + ";", ["count(*)"]);
      message.reply("User has said " + count + " different words.");
    } catch {
      message.reply("User hasn't said anything.");
    }
    return;
  }

  if(message.content.toLowerCase() === "servervocabsize" && runCommands) {
    var userCount: number;

    userCount = await queryForResult("select count(*) from " + serverSchema + "users;", ["count(*)"]);
    var totalVocabSize = 0;
    var uniqueWordList = new Array<string>();
    var userList = await queryForResults("select * from " + serverSchema + "users;", ["id"]);
    for(var c = 0; c < userCount; c++) {
      var thisWordTable = serverSchema + "u" + userList[c];
      try {
        var theseWords = await queryForResults("select word from " + thisWordTable + ";", ["word"]);
        var listLength = await queryForResult("select count(*) from " + thisWordTable + ";", ["count(*)"]);
        for(var d = 0; d < listLength; d++) {
          if(uniqueWordList.includes(theseWords[d]) === false) {
            uniqueWordList.push(theseWords[d]);
            totalVocabSize++;
          }
        }
      } catch (error) { if(!(error instanceof TypeError)) throw error; }
    }

    if(totalVocabSize > 0) {
      message.reply("Server has said " + totalVocabSize + " different words.");
    } else {
      message.reply("Server hasn't said anything.");
    }
    return;
  }

  if(message.content.toLowerCase().startsWith("addname") && runCommands) {
    var parameters: Array<string> = message.content.toLowerCase().split(" ");
    if(parameters.length != 3) {
      helpMessage(message);
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
      await query("insert into " + thisNameTable + " (name, id) values (" + "\'" + nickname + "\', " + person + ") on duplicate key update id = " + person + ";");
      dataChanged = true;
    } catch (error) {
      throw error;
    }
    return;
  }

  if(message.content.toLowerCase() === "bitchbothelp") {
    helpMessage(message);
    return;
  }

  var wordTable: string = "u" + message.author.id;

  // make tables for user
  await query("insert into " + serverSchema + "users (id) select \'" + message.author.id + "\' from dual where not exists (select id from " + serverSchema + "users where id=\'" + message.author.id + "\');");
  await query("create table if not exists " + serverSchema + wordTable + "(word varchar(50), uses bigint, primary key(word));");

  var words: Array<string> = message.content.trim().replace("\n", " ").split(" ");
  do {
    await handleWord(words[0], wordTable, serverSchema);
    words.shift();
  } while(words[0] !== undefined)

  if(runCommands) console.log("processed message from " + message.author.id + ".");
}

async function newMessage(message: Message, runCommands: boolean) {
  await query("create schema if not exists s" + message.guild!.id + ";");
  await query("create table if not exists s" + message.guild!.id + ".users(id varchar(50));");
  await query("create table if not exists s" + message.guild!.id + ".nicknames(name varchar(50), id varchar(50), primary key(name));");
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


async function execAsync(command: string) {
  return new Promise<void>((resolve) => {
    exec(command, (stdout, stderr) => {
      if(stdout) console.log(stdout);
      if(stderr) console.log(stderr);
      resolve();
    })
  })
}

async function exportSQL() {
  if(dataChanged === true) {
    dataChanged = false;
    console.log("exporting to dump.sql...");
    await execAsync("mysqldump --all-databases -u root -p --password=" + process.env.SQL_PASS + " >dump.sql");
    console.log("exported to dump.sql.");
  }
}


if(process.argv.length === 3) {
  if(process.argv[2] === "export") {
    dataChanged = true;
    await exportSQL();
    process.exit();
  }
}

setInterval(exportSQL, 60 * 1000);
run();