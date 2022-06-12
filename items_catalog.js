const {redis, system_path_list, mysql_config,} = require(process.env.CONFIG_PATH__NFT);
const {events_core_v2, _is, rand, asleep, create_id, abash_core, clone,} = require(process.env.TOOLS_PATH__NFT);


const mysql_require = require(system_path_list.modules.mysql);
const mysql = new mysql_require(mysql_config);

redis.settings.set({debug: false});
const redis_connect = redis.connect_v2();

const items_catalog = (() => {
	const {locks} = require(system_path_list.modules.web_locks);
	
	const config = require(process.env.CONFIG_PATH__NFT).items_catalog;
	
	const cache = (() => {
		const list = new Map();
		
		const load_from_db = async () => {
			const _list_from_db = await mysql.query("SELECT * FROM items_catalog");
			
			list.clear();
			for (const from_db of _list_from_db) {
				const to_list = {
					aid: +from_db.aid,
					data: {
						uid: from_db.uid,
						slug: from_db.slug,
						name: from_db.name,
						price: JSON.parse(from_db.price),
						risk_level: from_db.risk_level,
						ts: +from_db.ts,
						url: from_db.url,
						img: from_db.img,
					},
				};
				
				list.set(to_list.data.uid, to_list);
			}
			
			return true;
		};
		
		const update = (uid, data) => {
			list.set(uid, {
				aid: list.get(uid)?.aid ?? null,
				data: data,
			});
			upload_to_db(uid).catch(() => false);
			
			return true;
		};
		
		const find = uid => {
			if (list.has(uid) === false) return null;
			const _from_list = list.get(uid);
			
			if (_from_list.data.ts < Date.now() - config.cache.life_time) return null;
			
			return _from_list.data;
		};
		
		const upload_to_db = async (uid) => locks.request(`items_catalog:cache:db:update:${uid}`, async () => {
			let _from_list = list.get(uid) ?? null;
			
			if (_from_list === null) {
				redis_connect.modules.telegram.send(
					`items_catalog::cache::upload_to_db::error:: Cant find UID on list\n<pre>${JSON.stringify({uid})}</pre>`,
					"notice",
				);
				return "cant_find_on_list";
			}
			_from_list = clone(_from_list);
			// console.log("_from_list:::", _from_list);
			const _doing = _from_list.aid === null ? "create" : "update";
			
			switch (_doing) {
				default: {
					throw "invalid_doing";
				}
				case "create": {
					const data_to_db = {
						uid,
						price: JSON.stringify(_from_list.data.price),
						name: _from_list.data.name,
						slug: _from_list.data.slug,
						risk_level: _from_list.data.risk_level,
						ts: _from_list.data.ts,
						url: _from_list.data.url,
						img: _from_list.data.img,
					};
					
					try {
						const try_insert = await mysql.query("INSERT INTO items_catalog SET ?", data_to_db);
						if (try_insert?.insertId < 1) throw "В БД не добавилась ни одна строка";
						
						_from_list.aid = try_insert?.insertId;
						
					} catch (e) {
						redis_connect.modules.telegram.send(
							`items_catalog::cache::upload_to_db::error:: DB create record\n<pre>${JSON.stringify({uid, e, data_to_db,})}</pre>`,
							"notice",
						);
						return "error_db_record_create";
					}
					
					list.set(uid, _from_list);
					break;
				}
				
				case "update": {
					const data_to_db = {
						price: JSON.stringify(_from_list.data.price),
						name: _from_list.data.name,
						slug: _from_list.data.slug,
						risk_level: _from_list.data.risk_level,
						ts: _from_list.data.ts,
						url: _from_list.data.url,
						img: _from_list.data.img,
					};
					
					try {
						const try_update = await mysql.query("UPDATE items_catalog SET ? WHERE aid=? LIMIT 1", [
							data_to_db,
							_from_list.aid,
						]);
						if (try_update?.affectedRows !== 1) throw "В БД не изменилась ни одна строка";
						
						
					} catch (e) {
						redis_connect.modules.telegram.send(
							`items_catalog::cache::upload_to_db::error:: DB create record\n<pre>${JSON.stringify({uid, e, data_to_db,})}</pre>`,
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
			// console.log("list::", list)
			
			return true;
		}
		
		return {
			init,
			load_from_db, upload_to_db,
			update, find,
			get list() {
				return list
			},
		}
	})();
	
	/**
	 * Продолжение поиска предметов.
	 * Создаётся запись, контролирующая поисковые параметры, кол-во оставшихся попыток дозагрузки, времени жизни.
	 * Управляется передачей UID запроса. Запись создаётся при первом, кешированном поиске
	 */
	const more = (() => {
		const list = new Map();
		
		const _uids = (() => {
			const length = config.more.uid_length;
			const create = () => create_id(length, 0);
			const verif = data => _is.hex(data, length);
			return {
				create, verif,
				get get() {
					return create()
				},
			};
		})();
		
		const create = (data_to_search, cursor = null,) => {
			const record = {
				uid: _uids.get,
				args: data_to_search,
				cursor: cursor,
				
				try_left: config.more.try_count,
				ts_last: Date.now(),
				is_lock: false,
			};
			
			list.set(record.uid, record);
			
			return record;
		}
		
		const trying = uid => {
			if (_uids.verif(uid) === false) throw "system_error__USRokM";
			
			const record = list.get(uid) ?? null;
			if (record === null) throw "Reload page and try again";
			if (record.is_lock === true) throw "already busy";
			
			try {
				if (record.try_left <= 0) throw "Can't load anymore";
				if (record.ts_last <= Date.now() - config.more.lifetime) throw "Time is over. Try reloading the page";
			} catch (e) {
				list.delete(uid);
				throw e;
			}
			
			record.is_lock = true;
			record.try_left--;
			record.ts_last = Date.now();
			
			return {
				cursor: record.cursor,
				args: record.args,
			}
		};
		
		const update = (uid, cursor = null) => {
			if (_uids.verif(uid) === false) throw "system_error__2YHRh2";
			const record = list.get(uid) ?? null;
			if (record === null) throw "Try reload page"
			if (record.is_lock === false) throw "Is busy";
			const res = {
				is_end: true,
			};
			
			try {
				record.cursor = cursor;
				record.ts_last = Date.now();
				
				if (cursor === null) return "end of cursor";
				if (record.try_left <= 0) return "end of try";
				
				res.is_end = false;
				record.is_lock = false;
			} finally {
				if (res.is_end === true) list.delete(uid);
				
				return res;
			}
			
		}
		
		const _cleaning_init = () => {
			if (Number.isSafeInteger(config.more.interval_cleaning) === false || Number.isSafeInteger(config.more.interval_cleaning) <= 0) return "is_disabled";
			
			setInterval(() => {
				const _ts_expire = Date.now() - config.more.lifetime;
				for (const [uid, record] of list) {
					if (record.is_lock === true) continue;
					
					// 5  <=   10 - 10 / 3
					if (record.ts_last > _ts_expire) continue;
					
					list.delete(uid);
				}
				
				return true;
			}, config.more.interval_cleaning);
			
			return true;
		}
		
		const init = async () => {
			_cleaning_init();
			
			return true;
		}
		
		return {
			init,
			create, trying, update,
		}
	})();
	
	const select = (() => {
		const _config_form = require(process.env.CONFIG_PATH__NFT).items_parser.request;
		const _from_cache_to_request = item => {
			return {
				uid: item.uid,
				name: item.name,
				img: item.img,
				risk: item.risk_level,
				price_usd: item.price.usd,
				url: item.url,
			}
		};
		
		const search_by_form = ({price_max = null, price_min = null, risk_level = null, pool_amount_left = null,}) => {
			const res = new Map();
			
			const _ts_expire = Date.now() - config.cache.life_time;
			
			for (const [uid, item] of cache.list) {
				/*
				console.log("item::", item, price_min, price_max, [
					Number.isFinite(item.data.price.usd) === false,
					price_min !== null && item.data.price.usd < price_min,
					price_max !== null && item.data.price.usd > price_max,
					
					risk_level !== null && Number.isSafeInteger(risk_level) === true
				]);
				 */
				const _items_price_usd = item?.data?.price?.usd ?? null;
				
				console.log("_items_price_usd::", [
					_items_price_usd,
					pool_amount_left,
					price_min,price_max,
					_items_price_usd < price_min,
					_items_price_usd > price_max,
					_items_price_usd > pool_amount_left,
					item?.data?.risk_level > risk_level
				])
				
				if (Number.isFinite(_items_price_usd) === false || _items_price_usd <= 0) continue;
				
				if (price_max !== null || price_min !== null || pool_amount_left !== null) {
					if (price_min !== null && _items_price_usd < price_min) continue;
					if (price_max !== null && _items_price_usd > price_max) continue;
					if (_items_price_usd > pool_amount_left) continue;
				}
				if (risk_level !== null && Number.isSafeInteger(risk_level) === true) {
					if (Number.isSafeInteger(item.data.risk_level) === false) continue;
					if (item.data.risk_level > risk_level) continue;
				}
				if (item.data.ts < _ts_expire) continue;
				
				res.set(uid, _from_cache_to_request(item.data));
				pool_amount_left = Math.max(
					0,
					+(pool_amount_left - _items_price_usd).toFixed(2),
				);
				if (pool_amount_left <= 0) break;
			}
			/*
			// Добираем мелочь
			if (pool_amount_left > 0) {
				for (const [uid, item] of cache.list) {
					const _items_price_usd = item?.data?.price?.usd ?? null;
					if (Number.isFinite(_items_price_usd) === false || _items_price_usd <= 0) continue;
					if (_items_price_usd>pool_amount_left)continue;
					
					if (risk_level !== null && Number.isSafeInteger(risk_level) === true) {
						if (Number.isSafeInteger(item.data.risk_level) === false) continue;
						if (item.data.risk_level > risk_level) continue;
					}
					if (item.data.ts < _ts_expire) continue;
					
					res.set(uid, _from_cache_to_request(item.data));
					pool_amount_left = Math.max(
						0,
						+(pool_amount_left - _items_price_usd).toFixed(2),
					);
					if (pool_amount_left <= 0) break;
				}
			}
			*/
			
			if (1 === 1 || pool_amount_left < price_max) {
				price_max = +(pool_amount_left * _config_form.form.prices.more_factors.max).toFixed(2);
				price_min = Math.max(
					_config_form.form.prices.min,
					+(pool_amount_left * _config_form.form.prices.more_factors.min).toFixed(2),
				)
			}
			
			const data_to_search = {max_price: price_max, min_price: price_min, risk_level, pool_amount_left,};
			console.log("search_by_form::data_to_search::", data_to_search);
			const _more_record = more.create(
				data_to_search,
				null,
			);
			
			return {
				more_uid: _more_record.uid,
				list: [...res.values()],
			};
		}
		
		const search_by_more = async (more_uid = null) => {
			const _trying = more.trying(more_uid);
			try {
				const res = {
					list: new Map(),
					is_end: null,
				};
				
				const data_to_send = {
					..._trying.args,
					cursor: _trying.cursor,
				};
				console.log("search_by_more::data_to_send", data_to_send, _trying);
				const _res = await redis_connect.request.send(
					"items_parser:request",
					data_to_send,
					{like_obj: false},
				);
				
				for (const item of _res.list) {
					if (item.price.usd > _trying.args.pool_amount_left) continue;
					if (res.list.has(item.uid)) continue;
					
					_trying.args.pool_amount_left = Math.max(
						0,
						+(_trying.args.pool_amount_left - item.price.usd).toFixed(2),
					);
					
					if (_trying.args.pool_amount_left < _trying.args.min_price || _trying.args.pool_amount_left < _config_form.form.prices.min) {
						_res.cursor = null;
						break;
					}
					
					res.list.set(item.uid, _from_cache_to_request(item));
				}
				
				const _more_update = more.update(more_uid, _res.cursor);
				console.log("search_by_more::[items_parser:request]_res::", _res.list.length, _more_update);
				
				res.is_end = _more_update?.is_end === true;
				res.list = [...res.list.values()]
				return res;
			} catch (e) {
				console.log("search_by_more::error", e);
				more.update(more_uid, null);
				throw e;
			}
		}
		
		const init = async () => {
			redis_connect.request.on["items_collection:select:search_by_form"] = search_by_form;
			redis_connect.request.on["items_collection:select:search_by_more"] = search_by_more;
			
			return true;
		};
		
		return {
			init,
			search_by_form,
		}
	})();
	
	const init = async () => {
		await cache.init();
		await select.init();
		
		redis_connect.request.on["items_collection:cache:add"] = async item => cache.update(item.uid, item);
		
		return true;
	};
	
	return {
		init,
		cache, select,
	}
})();

(async () => {
	await items_catalog.init();
	console.log("items_catalog is init");
	
	/*
	console.log(
		"try_search::",
		items_catalog.select.search_by_form({price_max:500,price_min:4,risk_level:5,count:3})
	)
	*/
})();