// Для тестирования
const _env = {
	CONFIG_PATH__NFT: "/var/www/nft/libs/config.js",
	TOOLS_PATH__NFT: "/var/www/nft/libs/tools.js",
	NODE_IS_DEV: false,
	...globalThis?.process?.env,
};
_env.NODE_IS_DEV = _env.NODE_IS_DEV === true || _env.NODE_IS_DEV === "true";


const {redis,} = require(_env.CONFIG_PATH__NFT);
const {asleep, create_id, rand, clone, _is, events_core_v2, mongodb_require,} = require(_env.TOOLS_PATH__NFT);
const fs = require("fs");
const util = require("util");

redis.settings.set({debug: false});
const redis_connect = redis.connect_v2();


const browser = () => {
	const config = (() => {
		const _default = clone(require(_env.CONFIG_PATH__NFT).browser);
		let current = clone(_default);
		// console.log("current::",current);
		
		return {
			get current() {
				return current
			},
			set update(value) {
				current = {
					...current,
					...value,
				}
			}
		}
	})();
	const _module = require("puppeteer");
	let self = null;
	
	const preset_list = (() => {
		const total_list = new Map();
		
		const set = (key, value = []) => {
			if (value === null || value === undefined) value = [];
			
			if (Array.isArray(value) === false) value = [value];
			total_list.set(key, value);
			return true;
		}
		const get = key => {
			if (total_list.has(key) === false) return [];
			return total_list.get(key);
		}
		
		return {
			set, get,
		}
	})();
	
	const pages = (() => {
		
		const utils = (() => {
			const _url_pattern = require('url-pattern');
			
			const preset = async (page_self, flags = []) => {
				await page_self.setUserAgent(config.current.page.user_agent);
				await page_self.setViewport(config.current.page.resolution);
				// console.log("config.current::", config.current);
				if (config.current.proxy.is_enabled === true && config.current.proxy.login && config.current.proxy.pass) {
					await page_self.authenticate({username: config.current.proxy.login, password: config.current.proxy.pass,});
				}
				
				return true;
			}
			
			const network = async (page_self) => {
				const events = events_core_v2();
				//const wait_res = events.after();
				const logs = (() => {
					const list = new Set();
					
					const clear = () => list.clear();
					
					const _event_url__encode = url => `logs:add:url:[${url}]`;
					
					const _add = ({url, res}) => {
						list.add({url, res});
						events.emit(_event_url__encode(url), res);
						events.emit("logs:add:url", {url, res});
						return true;
					};
					
					const _parse_search = text_or_fn => {
						const res = {
							original: text_or_fn,
							type: null,
							fn: null,
							_fn_help: null,
						};
						if (typeof text_or_fn === "function") {
							res.type = "fn";
							res.fn = text_or_fn;
						} else {
							res._fn_help = new _url_pattern(text_or_fn);
							console.log("_parse_search:: rule of REGEX", res);
							res.type = "regex";
							res.fn = ({url}) => (res._fn_help.match(url) !== null);
						}
						return res;
					}
					
					const handler = res => {
						const url = res.url();
						//console.log("logs::handler::url::", url);
						
						_add({url, res});
						
						return true;
					}
					
					const find = (text_or_fn, {limit = 1} = {}) => {
						if (limit !== null) {
							if (Number.isSafeInteger(limit) === false) limit = null;
							else if (limit < 1) limit = 1;
						}
						
						const _search = _parse_search(text_or_fn);
						
						const res = [];
						for (const record of list) {
							if (_search.fn(record) === false) continue;
							
							res.push(record.res);
							if (limit !== null && res.length >= limit) break;
						}
						
						return limit === 1 ? res[0] || null : res;
					}
					
					const wait = async (text_or_fn, {from_already = true, timeout = null, like_obj = false}) => {
						if (from_already === true) {
							const _res = find(text_or_fn);
							if (_res !== null) return _res;
						}
						
						const res = {success: false, body: "init_error"};
						try {
							const _res_from_events = await new Promise((g, b) => {
								const _ids = {
									event: null,
									timer: null,
								};
								
								const _search = _parse_search(text_or_fn);
								console.log("_res_from_events::as::_search::", _search);
								_ids.event = events.on("logs:add:url", record => {
									if (_search.fn(record) === false) return false;
									events.clear(_ids.event);
									if (_ids.timer !== null) clearTimeout(_ids.timer);
									
									g(record.res);
									return true;
								});
								if (Number.isSafeInteger(timeout) && timeout > 0) {
									_ids.timer = setTimeout(() => {
										events.clear(_ids.event);
										b("timeout");
										return true;
									}, timeout);
								}
								
								return true;
							});
							
							res.success = true;
							res.body = _res_from_events;
						} catch (e) {
							res.success = false;
							res.body = e;
						}
						
						if (like_obj === true) return res;
						
						if (res.success === false) throw res.body;
						return res.body;
					};
					
					const listen = (text_or_fn, fn) => {
						const _ids = {
							event: null,
						};
						
						const stop = () => (events.clear(_ids.event), true);
						
						const _search = _parse_search(text_or_fn);
						console.log("_res_from_events::as::_search::listen::", _search);
						_ids.event = events.on("logs:add:url", record => {
							if (_search.fn(record) === false) return false;
							
							fn(record);
							return true;
						});
						
						return {
							stop,
						}
					};
					
					
					const init = () => {
						clear();
						page_self.on("response", res => {
							try {
								handler(res);
							} catch (e) {
								console.log("page_self.on:: res :: err", e);
							}
						});
						
						return true;
					}
					return {
						init,
						clear, find, wait, listen,
						get list() {
							return list
						},
					}
				})();
				
				const rules = (() => {
					const list = new Map();
					
					const add = (url_of_regex, cb) => {
						const regex_of_url = new _url_pattern(url_of_regex);
						list.set(regex_of_url, cb);
						return true;
					};
					const clear = () => list.clear();
					
					const find = resource_url => {
						for (const [rule_regex, rule_cb] of list) {
							const match_params = rule_regex.match(resource_url);
							if (match_params === null) continue;
							return {
								rule: rule_regex,
								cb: rule_cb,
								params: match_params,
							}
						}
						return null;
					}
					
					const handler = async req => {
						const _url = req.url();
						//console.log("rules::handler::url::", _url);
						
						const _found = rules.find(_url);
						if (_found === null) return req.continue();
						try {
							await _found.cb(req, {params: _found.params});
						} catch (e) {
							console.log("rules::handler::error::", e);
							
							req.abort("failed");
							return false;
						}
						
						return true;
					};
					
					const short = (url_or_regex, request_doing, reason = null) => {
						const _args_to_cb = {fn_name: null, reason};
						
						switch (request_doing) {
							default: {
								throw "unexpected type of doing";
							}
							case "abort": {
								_args_to_cb.fn_name = "abort";
								_args_to_cb.reason = reason ?? "blockedbyclient";
							}
						}
						
						if (_args_to_cb.fn_name === null) throw "error__ovEa2G";
						// console.log("pages::utils::network::rules::short::", _args_to_cb);
						add(url_or_regex, req => (req[_args_to_cb.fn_name](_args_to_cb.reason), true));
						
						return true;
					}
					
					const init = () => {
						page_self.on("request", handler);
						
						return true;
					}
					
					return {
						init,
						find, clear,
						add, short,
						get list() {
							return list
						},
					}
				})();
				
				/**
				 *
				 * @param url
				 * @param options
				 * @param flags =>
				 * "logs_save": Not clear logs
				 *
				 * @returns {Promise<*>}
				 */
				const goto = async (url, options = {waitUntil: "networkidle0"}, flags = []) => {
					flags = new Set(flags || []);
					if (flags.has("logs_save")) logs.clear();
					return page_self.goto(url, options);
				}
				
				logs.init();
				rules.init();
				await page_self.setRequestInterception(true);
				
				return {
					rules, logs,
					goto,
				}
			};
			
			return {
				preset, network,
			}
		})();
		
		const create = async () => {
			const page_self = await self.newPage();
			await utils.preset(page_self);
			const network = await utils.network(page_self);
			
			for (const record_of_rule of preset_list.get("network_rules")) {
				network.rules.short(...record_of_rule)
			}
			
			// if (1 === 1) {
			// 	network.rules.add("*//mc.yandex.ru/*", async req => (console.log("stop yandex metrica"), req.abort("blockedbyclient"), true));
			// 	network.rules.add("*.yandex.net/*", async req => (console.log("stop yandex metrica, 2"), req.abort("blockedbyclient"), true));
			// 	network.rules.add("*//www.google-analytics.com/*", async req => (console.log("stop google metrica"), req.abort("blockedbyclient"), true));
			// 	network.rules.add("*//www.googletagmanager.com/*", async req => (console.log("stop google metrica, 2"), req.abort("blockedbyclient"), true));
			// 	network.rules.add("*//yastatic.net/*", async req => (console.log("stop yastatic"), req.abort("blockedbyclient"), true));
			// }
			
			
			return {
				get self() {
					return page_self
				},
				network,
			}
		};
		
		return {
			utils,
			create,
		}
	})();
	
	const init = async (config_update = {}, program_args = {}, {network_rules = null}, browser_args = []) => {
		config.update = config_update;
		preset_list.set("network_rules", network_rules);
		
		//const _args = [`--no-sandbox`,`--remote-debugging-port=34513`,`--remote-debugging-address=0.0.0.0`];
		const _args = [`--no-sandbox`, ...browser_args];
		// console.log("config.current::", config.current);
		if (config.current.proxy.is_enabled) _args.push(`--proxy-server=${config.current.proxy.ip}:${config.current.proxy.port}`);
		self = await _module.launch({
			headless: !_env.NODE_IS_DEV,
			userDataDir: config.current.profile_directory,
			args: _args,
			...program_args,
		});
		
		return true;
	}
	
	return {
		init,
		get self() {
			return self
		},
		
		pages,
		preset_list,
	}
};


module.exports = browser;
