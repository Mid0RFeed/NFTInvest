const {redis, system_path_list, mysql_config,} = require(process.env.CONFIG_PATH__NFT);
const {events_core_v2, _is, rand, asleep, create_id, abash_core, clone,} = require(process.env.TOOLS_PATH__NFT);


const mysql_require = require(system_path_list.modules.mysql);
const mysql = new mysql_require(mysql_config);

const fs = require("fs");
const crypto = require("crypto");

redis.settings.set({debug: false});
const redis_connect = redis.connect_v2();


const collect_stats = (() => {
	const {locks} = require(system_path_list.modules.web_locks);
	
	const config = {
		cache: {
			life_time: 12 * 60 * 60 * 1000,
		},
		fetch: {
			url: {
				prefix: "https://api.opensea.io/api/v1/collection/",
				postfix: "/stats",
			},
		},
		risk_calc: {
			// cmd: `RISK_CALK`,
			cmd: `echo`,
			timeout: 2 * 1000,
		}
	};
	
	const cache = (() => {
		const list = new Map();
		
		const load_from_db = async () => {
			const _list_from_db = await mysql.query("SELECT * FROM collect_stats");
			
			list.clear();
			for (const from_db of _list_from_db) {
				const to_list = {
					aid: +from_db.aid,
					data: {
						slug: from_db.slug,
						stats: JSON.parse(from_db.stats),
						calc: JSON.parse(from_db.calc),
						risk_level: from_db.risk_level,
						ts: +from_db.ts,
					},
				};
				
				list.set(to_list.data.slug, to_list);
			}
			
			return true;
		};
		
		const update = (slug, data) => {
			list.set(slug, {
				aid: list.get(slug)?.aid ?? null,
				data: data,
			});
			upload_to_db(slug);
			
			return true;
		};
		
		const find = slug => {
			if (list.has(slug) === false) return null;
			const _from_list = list.get(slug);
			
			if (_from_list.data.ts < Date.now() - config.cache.life_time) return null;
			
			return _from_list.data;
		};
		
		const upload_to_db = async (slug) => locks.request(`collect_stats:cache:db:update:${slug}`, async () => {
			let _from_list = list.get(slug) ?? null;
			
			if (_from_list === null) {
				redis_connect.modules.telegram.send(
					`collect_stats::cache::upload_to_db::error:: Cant find SLUG on list\n<pre>${JSON.stringify({slug})}</pre>`,
					"notice",
				);
				return "cant_find_on_list";
			}
			_from_list = clone(_from_list);
			console.log("_from_list:::", _from_list);
			const _doing = _from_list.aid === null ? "create" : "update";
			
			switch (_doing) {
				default: {
					throw "invalid_doing";
				}
				case "create": {
					const data_to_db = {
						slug,
						stats: JSON.stringify(_from_list.data.stats),
						calc: JSON.stringify(_from_list.data.calc),
						risk_level: _from_list.data.risk_level,
						ts: _from_list.data.ts,
					};
					
					try {
						const try_insert = await mysql.query("INSERT INTO collect_stats SET ?", data_to_db);
						if (try_insert?.insertId < 1) throw "В БД не добавилась ни одна строка";
						
						_from_list.aid = try_insert?.insertId;
						
					} catch (e) {
						redis_connect.modules.telegram.send(
							`collect_stats::cache::upload_to_db::error:: DB create record\n<pre>${JSON.stringify({slug, e, data_to_db,})}</pre>`,
							"notice",
						);
						return "error_db_record_create";
					}
					
					list.set(slug, _from_list);
					break;
				}
				
				case "update": {
					const data_to_db = {
						stats: JSON.stringify(_from_list.data.stats),
						calc: JSON.stringify(_from_list.data.calc),
						risk_level: _from_list.data.risk_level,
						ts: _from_list.data.ts,
					};
					
					try {
						const try_update = await mysql.query("UPDATE collect_stats SET ? WHERE aid=? LIMIT 1", [
							data_to_db,
							_from_list.aid,
						]);
						if (try_update?.affectedRows !== 1) throw "В БД не изменилась ни одна строка";
						
						
					} catch (e) {
						redis_connect.modules.telegram.send(
							`collect_stats::cache::upload_to_db::error:: DB create record\n<pre>${JSON.stringify({slug, e, data_to_db,})}</pre>`,
							"notice",
						);
						return "error_db_record_update";
					}
					
					break;
				}
			}
			
			return true;
		});
		
		const init = async () => {
			await load_from_db();
			console.log("list::", list)
			return true;
		}
		
		return {
			init,
			load_from_db, upload_to_db,
			update, find,
		}
	})();
	
	const fetch = (() => {
		const _request = require("request");
		
		/**
		 *
		 * @param slug
		 *
		 * res example:
			{
			  success: true,
			  body: {
			    one_day_volume: 0.8052038899999994,
			    one_day_change: -0.05385547975482033,
			    one_day_sales: 57,
			    one_day_average_price: 0.014126384035087708,
			    seven_day_volume: 14.104074659899958,
			    seven_day_change: -0.6969190474127464,
			    seven_day_sales: 857,
			    seven_day_average_price: 0.01645749668599762,
			    thirty_day_volume: 115.79875505953439,
			    thirty_day_change: 0.01296494438167021,
			    thirty_day_sales: 4052,
			    thirty_day_average_price: 0.028578172522096344,
			    total_volume: 1764.672769736037,
			    total_sales: 59505,
			    total_supply: 7,
			    count: 7,
			    num_owners: 517067,
			    average_price: 0.02965587378768233,
			    num_reports: 6,
			    market_cap: 0.11520247680198331,
			    floor_price: 0.0025
			  }
			}
		 */
		const request = async (slug) => locks.request("collect_stats:request", async () => {
			const res = {
				success: false,
				body: "init_error",
				
			}
			
			try {
				if (typeof slug !== "string" || slug.length > 160 || slug.length === 0) throw "invalid_args__slug";
				
				const data_to_send = [config.fetch.url.prefix, slug, config.fetch.url.postfix].join("");
				
				const _res = await new Promise((g, b) => _request(data_to_send,
					(err, res, body) => {
						// console.log("body::", body, err);
						
						return err ? b(err) : g(body);
					}
				));
				
				const _json = JSON.parse(_res);
				if (_json?.success === false) throw "cant_find";
				if (_json?.stats instanceof Object === false) throw "invalid_res";
				res.success = true;
				res.body = _json.stats;
			} catch (e) {
				res.success = false;
				res.body = e;
			}
			
			if (res.success === false) {
				redis_connect.modules.telegram.send(
					`collect_stats::fetch::request::error:: Request fail\n<pre>${JSON.stringify({slug, error: res.body.toString()})}</pre>`,
					"notice",
				);
			}
			
			return res;
		});
		
		
		const main = async (slug) => locks.request(`collect_stats:get:${slug}`, async () => {
			const _from_cache = cache.find(slug);
			if (_from_cache != null) return _from_cache;
			
			const record_data = {
				slug,
				stats: null,
				calc: null,
				risk_level: null,
				ts: null,
			}
			
			const _stats = await request(slug);
			if (_stats.success === false) throw _stats.body;
			record_data.stats = _stats.body;
			
			const _risk_calc = await risk_calc.main(record_data.stats);
			if (_risk_calc.success === false) throw _risk_calc.body;
			
			record_data.calc = _risk_calc.body.calc;
			record_data.risk_level = _risk_calc.body.risk_level;
			
			record_data.ts = Date.now();
			
			cache.update(slug, record_data);
			
			return clone(record_data);
		});
		
		return {
			request,
			main,
		};
	})();
	
	const risk_calc = (() => {
		const abash = abash_core();
		
		// Запускает BASH команду, с аргументов в виде JSON
		// res: {body: OBJECT, success: BOOL }
		/**
		res.body = {
			risk_level: Int, // 0 = минмальный риск
			calc: Object, // Остальные данные, которые необходимо сохранить
		}
		 */
		if (1 === 1) {
			const main = async (data_to_send) => {
				const res = {success: false, body: "init_error"};
				try {
					if (data_to_send instanceof Object === false) throw "invalid_arg_type";
					// Составление BASH команды, для оценки риска
					const _cmd_text = `${config.risk_calc.cmd} '${JSON.stringify(data_to_send)}'`;
					
					const _res = await abash(
						_cmd_text,
						{
							timeout: config.risk_calc.timeout,
						}
					)
					
					res.success = true;
					res.body = _res;
				} catch (e) {
					res.success = false;
					res.body = e;
				}
				return res;
				
			};
		}
		// Имитация работы. Для debug
		const main = async (data_to_send) => {
			const res = {success: false, body: "init_error"};
			try {
				if (data_to_send instanceof Object === false) throw "invalid_arg_type";
				
				const data_to_resend = {
					risk_level: rand(0, 5),
					calc: {
						some: "test_value",
						another: "value",
					}
				};
				
				const _cmd_text = `${config.risk_calc.cmd} '${JSON.stringify(data_to_resend)}'`;
				// console.log("_cmd_text::",[_cmd_text])
				
				let _res = await abash(
					_cmd_text,
					{
						timeout: config.risk_calc.timeout,
					}
				)
				
				if (_res.endsWith("\n")) {
					_res = JSON.parse(_res.slice(0, -1));
				}
				
				res.success = true;
				res.body = _res;
			} catch (e) {
				res.success = false;
				res.body = e;
			}
			
			return res;
		};
		
		return {
			main,
		}
	})();
	
	const init = async () => {
		await cache.init();
		
		// Глобальный обработчик, чтобы вызывать из других скриптов
		redis_connect.request.on["collect_stats:fetch"] = fetch.main;
		redis_connect.request.on["collect_stats:fetch:many"] = async (slugs_array) => {
			if (Array.isArray(slugs_array) === false || slugs_array.length === 0) throw "invalid_args";
			
			const slugs_to_check = new Set(slugs_array);
			const res = {};
			
			await Promise.all(
				[...slugs_to_check].map(async slug => {
					res[slug] = await fetch.main(slug);
					return true;
				})
			);
			
			return res;
		};
		
		return true;
	};
	
	return {
		init,
		fetch, cache, risk_calc,
		
	}
})();


(async () => {
	await collect_stats.init();
	
	console.log("ALL READY");
	
	// collect_stats.fetch.request("hantom-galaxies-origin-collection").then(console.log, console.log);
	// collect_stats.risk_calc.main({some:123,x:"213\n12rf\nasfsf"}).then(console.log, console.log);
	
	// collect_stats.fetch.main("goblintownwtf").then(console.log, console.log);
	/*
	if (1 === 2) {
		collect_stats.risk_calc.main(
			{
				"stats": {
					"one_day_volume": 1293.0412856684018,
					"one_day_change": 0.12768499015699142,
					"one_day_sales": 450.0,
					"one_day_average_price": 2.873425079263115,
					"seven_day_volume": 10846.458759561461,
					"seven_day_change": 4.149472210198996,
					"seven_day_sales": 8938.0,
					"seven_day_average_price": 1.2135219019424324,
					"thirty_day_volume": 12952.783119964659,
					"thirty_day_change": 0.0,
					"thirty_day_sales": 21641.0,
					"thirty_day_average_price": 0.5985297869767875,
					"total_volume": 12952.783119964659,
					"total_sales": 21641.0,
					"total_supply": 9999.0,
					"count": 9999.0,
					"num_owners": 4528,
					"average_price": 0.5985297869767875,
					"num_reports": 33,
					"market_cap": 12134.005497522381,
					"floor_price": 2.85
				}
			}
		).then(console.log, console.log);
	}
	*/
	
})();