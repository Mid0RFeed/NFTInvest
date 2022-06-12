const {redis, system_path_list, mysql_config,} = require(process.env.CONFIG_PATH__NFT);
const {events_core_v2, _is, rand, asleep, create_id, obj_lazy, telegram_uploader,} = require(process.env.TOOLS_PATH__NFT);


const mysql_require = require(system_path_list.modules.mysql);
const mysql = new mysql_require(mysql_config);

const fs = require("fs");
const crypto = require("crypto");

redis.settings.set({debug: false});
const redis_connect = redis.connect_v2();

(async () => {
	console.log("123");
	
	await mysql.query("SELECT * FROM collect_stats").then(console.log,console.log)
})();