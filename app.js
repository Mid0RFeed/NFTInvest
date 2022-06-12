const _env = {
	CONFIG_PATH__NFT: "/var/www/nft/libs/config.js",
	TOOLS_PATH__NFT: "/var/www/nft/libs/tools.js",
	NODE_IS_DEV: false,
	...globalThis?.process?.env,
};
_env.NODE_IS_DEV = _env.NODE_IS_DEV === true || _env.NODE_IS_DEV === "true";

const {redis, system_path_list,} = require(_env.CONFIG_PATH__NFT);
const {asleep, create_id, rand, clone, _is, events_core_v2, telegram_uploader,} = require(_env.TOOLS_PATH__NFT);
const fs = require("fs");
const util = require("util");

const _telegram__error_convert_to_log = e => {
	console.log("TELEGRAM SEND MSG::", e);
	return util.inspect(
		e,
		{
			showHidden: true,
			depth: 50,
			showProxy: true,
			maxArrayLength: 500,
			getters: true,
		},
	);
};
const _upload_to_tg = telegram_uploader();

redis.settings.set({debug: false});
const redis_connect = redis.connect_v2();

const mysql_require = require(system_path_list.modules.mysql);
// const mysql = _env.NODE_IS_DEV === false ? new mysql_require(mysql_config) : {};
const mysql = {};

const {locks} = require(system_path_list.modules.web_locks);


const browser = require(system_path_list.modules.browser)();

let page;

const log_with_screenshot = async (page, error, desc) => {
	if (_env.NODE_IS_DEV === true) {
		console.log("log_with_screenshot:: DISABLED, IS TEST");
		return false;
	}
	
	redis_connect.modules.telegram.send(`parser::SITE_PARSER[log_with_screenshot]:: ${desc}\n${_telegram__error_convert_to_log(error)}`, "notify");
	
	let _url = "EMPTY";
	try {
		_url = await page.self.url();
		await page.self.waitForNavigation({timeout: 12 * 1000, waitUntil: "networkidle2"}).catch(() => false);
		
		const screenshot_buffer = await page.self.screenshot({encoding: "binary", type: 'png',});
		if (Number.isSafeInteger(screenshot_buffer?.length) === false || screenshot_buffer.length < 1) throw "empty_binary_data_of_screenshot";
		
		await _upload_to_tg.files(
			[
				{
					buffer: screenshot_buffer,
					name: `page_${Date.now()}.png`,
					type: "photo",
					extra: {
						caption: `url "${_url}"`,
					},
				}
			],
			"notify",
		);
	} catch (e) {
		redis_connect.modules.telegram.send(`parser::SITE_PARSER::[screenshot] Error with "${_url}":: \n${_telegram__error_convert_to_log(e)}`, "notify");
	}
	return true;
};


const config = require(_env.CONFIG_PATH__NFT).items_parser;

if (1 === 1)
	(async () => {
		
		await browser.init(
			config.browser.config,
			{},
			config.browser.network_rules,
			[
				// `--remote-debugging-address=`, // ip
				// `--remote-debugging-port=`, // port
			],
		);
		browser.self.on("disconnected", async data => {
			console.log("browser.self.on:: disconnected::", data);
			redis_connect.modules.telegram.send(`:parser::SITE_PARSER:: BROWSER HAS BEEN CLOSED! `, "notify");
			await asleep(500);
			process.exit(-1);
		});
		// browser.self.wsEndpoint();
		console.log("browser ready");
		
		page = await browser.pages.create();
		
		const items_parser = (() => {
			const auth = (() => {
				const status = {
					is_ready: false,
					cb: {g: null, b: null,},
					wait: null,
					
					to_request: {
						headers: {},
						query: null,
					},
				};
				
				const start = async () => {
					while (true) {
						status.is_ready = false;
						// status.cb.g = status.cb.b = null;
						status.wait = new Promise((g, b) => (status.cb.g = g, status.cb.b = b, true));
						
						page.network.logs.clear();
						
						try {
							await page.network.goto(config.auth.url, {waitUntil: "domcontentloaded"});
							await page.self.waitForSelector(config.auth.elements.unit_of_content.selector, {timeout: config.auth.elements.unit_of_content.timeout});
							// await page.self.screenshot({path: 'img/auth/start.png'});
							await log_with_screenshot(page, "iter - start");
							console.log("refresh list for fetch headers");
							// return false;
							
							page.network.logs.clear();
							// Нажимаем на кнопку "Обновить список". Только на нём приходят нужные HEADERS для подмены запроса
							await page.self.evaluate(
								async (selector) => {
									document.querySelector(selector).click();
									return true;
								},
								config.auth.elements.refresh_list,
							);
							
							const resource_of_init_fetch = await page.network.logs.wait(
								record => {
									if (record.url.includes(config.request.hostname) === false) return false;
									const headers_full = record.res?._request?._headers ?? {};
									const headers_parsed = {};
									for (const cell of config.request.headers_parse) {
										headers_parsed[cell] = headers_full[cell] ?? null;
									}
									// console.log("start::headers", headers_full, headers_parsed, record.res?._request, record.res?._request?._postData);
									
									if (record.res?._request?._headers?.[config.request.headers_parse[0]] === undefined) return false;
									if (record.res?._request?._method !== "POST" || typeof record.res?._request?._postData !== "string") return false;
									return record.res._request._postData.includes("AssetSearchQuery");
								},
								{from_already: true, timeout: 2 * 60 * 1000},
							);
							
							for (const cell of config.request.headers_parse) {
								const value = resource_of_init_fetch?._request?._headers?.[cell] ?? null;
								if (value === null) throw "empty_header_cell";
								
								status.to_request.headers[cell] = value;
							}
							status.to_request.query = JSON.parse(resource_of_init_fetch?._request?._postData).query;
							
							status.cb.g(true);
							status.is_ready = true;
						} catch (e) {
							console.log("ERROR ON BROWSER::", e);
							status.cb.b(e);
						} finally {
							await asleep(rand(config.auth.lifetime.min, config.auth.lifetime.max));
						}
					}
					
					throw "while_is_end";
				};
				
				const init = async () => {
					start();
					await status.wait;
					
					return true;
				}
				
				return {
					init,
					start,
					get ready() {
						if (status.is_ready === true) return true;
						return status.wait;
					},
					get is_ready() {
						return status.is_ready;
					},
					get to_request() {
						return clone(status.to_request);
					},
				}
			})();
			
			const request = (() => {
				const page_eval = async (data_to_send) => {
					const res = {success: false, body: "init_error"};
					
					try {
						const to_request = auth.to_request;
						
						const _res = await page.self.evaluate(
							async ({body, headers, url,}) => {
								const res_of_fetch = await fetch(url, {
									"headers": {
										"accept": "*/*",
										"accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
										"content-type": "application/json",
										
										// "x-api-key": null,
										// "x-build-id": null,
										// "x-signed-query": null,
										...headers,
									},
									"referrer": "https://opensea.io/",
									"referrerPolicy": "strict-origin",
									// "body": JSON.stringify(body),
									"body": JSON.stringify(body),
									"method": "POST",
									"mode": "cors",
									"credentials": "include",
								}).then(res => res.json());
								return res_of_fetch;
							},
							{
								body: {
									...data_to_send,
									query: to_request.query,
								},
								headers: to_request.headers,
								url: config.request.url,
							}
						);
						// console.log("_res?.data::", _res);
						if (Array.isArray(_res?.data?.query?.search?.edges ?? null) === false) {
							throw "invalid_res";
						}
						
						res.body = _res;
						res.success = true;
					} catch (e) {
						res.success = false;
						res.body = e;
					} finally {
						// console.log("items_parser::request::page_eval::Res", res);
					}
					
					return res;
				};
				
				const _item_parse_price = item_asset => {
					const price_calc = {
						asset: null,
						original: null,
						count_to_add: 0,
						string: null,
						
						type: null,
						float: null,
						img: null,
						
						usd: null,
					}
					price_calc.data_original = item_asset?.orderData?.bestAsk?.paymentAssetQuantity?.quantity ?? null;
					if (price_calc.data_original === null) throw "empty_price";
					price_calc.asset = item_asset.orderData.bestAsk.paymentAssetQuantity?.asset ?? null;
					if (price_calc.asset === null) throw "empty_price_asset";
					
					price_calc.count_to_add = price_calc.asset.decimals - price_calc.data_original.length;
					if (price_calc.count_to_add >= 0) {
						price_calc.string = "0." + "0".repeat(price_calc.count_to_add) + price_calc.data_original;
					} else {
						const data_array = Array.from(price_calc.data_original);
						data_array.splice(Math.abs(price_calc.count_to_add), 0, ".");
						price_calc.string = data_array.join("");
					}
					if (price_calc.string === null) throw "some_wrong_on_parse_price";
					price_calc.float = parseFloat(price_calc.string) ?? null;
					if (price_calc.float === null || Number.isFinite(price_calc.float) === false) throw "invalid_price_after_parse";
					price_calc.type = price_calc.asset.symbol;
					price_calc.img = price_calc.asset.imageUrl;
					
					price_calc.usd = +(price_calc.float * price_calc.asset.usdSpotPrice).toFixed(2);
					
					return price_calc;
				}
				
				const main = async ({cursor = null, min_price = null, max_price = null, risk_level = config.request.form.risk_level.default} = {}) => locks.request("items_parser:request", async () => {
					await auth.ready;
					
					
					if (Number.isSafeInteger(risk_level) === false) throw "risk_level_is_invalid";
					if (risk_level > config.request.form.risk_level.max) throw "risk_level_is_to_high";
					if (risk_level < config.request.form.risk_level.min) throw "risk_level_is_to_low";
					
					if (max_price < config.request.form.prices.min) throw "price_is_to_low";
					if (max_price > config.request.form.prices.max) throw "price_is_to_high";
					if (min_price !== null) {
						if (Number.isFinite(min_price) === false || min_price < config.request.form.prices.min || min_price > max_price) {
							min_price = null;
						}
					}
					const price = {
						max: max_price,
						min:
							min_price
							??
							Math.max(
								config.request.form.prices.min,
								+(max_price * config.request.form.prices.factors.min).toFixed(2),
							),
					};
					if (price.min < config.request.form.prices.min) throw "price_is_to_low__after_calc";
					
					const data_to_send = clone(config.request.send);
					
					data_to_send.variables.priceFilter.min = price.min;
					data_to_send.variables.priceFilter.max = price.max;
					data_to_send.variables.cursor = cursor;
					/**
					 * Набираем предметы для выдачи.
					 * Собираем список коллекций, получаем калькуляцию их риска с другой сущности.
					 * Фильтруем по указанному пользователю риску.
					 * Если элементов для выдачи не набралось, а страницы с ними ещё не закончились, то идём на след итэрацию цикла
					 *
					 * Элементы, у которых удалось спрарсить и скалькулировать статистику, отправляются в Cache.
					 */
					const res = {
						cursor: null,
						list: new Map(),
					}
					for (let try_left = config.request.form.try_count; try_left--; try_left > 0) {
						console.log("items_parser::request::main::iter", [try_left, res.list.size]);
						const _page_eval__res = await page_eval(data_to_send);
						console.log("items_parser::request::main::res_after::", _page_eval__res);
						
						if (_page_eval__res.success === false) {
							console.log("Неудалось получить данные со страницы", _page_eval__res);
							log_with_screenshot(page, _page_eval__res.body);
							break;
						}
						
						const collection_list_of_uniq = new Map(
							_page_eval__res.body.data.query.search.edges
								.filter(record => typeof record.node?.asset?.collection?.slug === "string")
								.map(record => [record.node.asset.collection.slug, null])
						);
						const _collection_stats_calc = await redis_connect.request.send(
							"collect_stats:fetch:many",
							[...collection_list_of_uniq.keys()],
							{like_obj: false, timeout: 2 * 60 * 1000},
						);
						// console.log("_collection_stats_calc::", _collection_stats_calc);
						
						for (const [slug] of collection_list_of_uniq) {
							const res = _collection_stats_calc[slug] ?? null
							if (res === null || res.success === false) continue;
							collection_list_of_uniq.set(slug, res.body);
						}
						console.log("collection_list_of_uniq::", collection_list_of_uniq);
						
						// console.log("_page_eval__res.body.data.query.search.edges::", _page_eval__res.body.data.query.search.edges);
						res.cursor = _page_eval__res.body?.data?.query?.search?.pageInfo?.hasNextPage === true ? _page_eval__res.body?.data?.query?.search?.pageInfo?.endCursor : null ?? null;
						
						for (const record of _page_eval__res.body.data.query.search.edges) {
							const item = {
								uid: record.node.asset.id,
								name: record.node.asset.name,
								slug: record.node.asset.collection.slug,
								price: {
									usd: null,
									origin: {
										type: null, value: null, img: null,
									},
								},
								risk_level: null,
								url: null,
								img: null,
								ts: Date.now(),
							};
							item.name = item.name ?? item.slug;
							if (typeof item.name === "string" && item.name.length > 0) {
								item.name = Array.from(item.name)
									.filter(char => Buffer.from(char).length <= config.request.form.char_size_max)
									.join("");
							}
							
							try {
								
								const stats = collection_list_of_uniq.get(item.slug) ?? null;
								if (stats === null) throw "empty_stats";
								
								const _price_calc = _item_parse_price(record.node?.asset);
								
								item.price.usd = _price_calc.usd;
								item.price.origin.type = _price_calc.type;
								item.price.origin.value = _price_calc.float;
								item.price.origin.img = _price_calc.img;
								
								item.risk_level = stats.risk_level;
								item.img = record.node.asset?.displayImageUrl ?? record.node.asset?.imageUrl;
								if (record.node.asset?.assetContract !== undefined) {
									item.url = [
										config.request.item_url.prefix,
										record.node.asset?.assetContract.chain.toLowerCase(),
										record.node.asset?.assetContract.address,
										record.node.asset?.tokenId,
									].join(config.request.item_url.joiner)
								}
								
								console.log("record.node.asset?.displayImageUrl::", record.node.asset, record.node.asset?.displayImageUrl);
								
								if (res.list.has(item.uid)) continue;
								
								// Добавляем в cache
								redis_connect.request.send("items_collection:cache:add", item, {like_obj: true, timeout: 10 * 1000}).catch(() => false);
								
								if (item.risk_level > risk_level) continue;
								
								res.list.set(item.uid, item);
							} catch (e) {
								console.log("item build::error::", e, item);
								continue;
							}
							
						}
						
						if (res.list.size >= config.request.form.list_count_min) break;
						if (_page_eval__res.body?.data?.query?.search?.pageInfo?.hasNextPage !== true) {
							console.log("end of pages", _page_eval__res.body?.data?.query?.search?.pageInfo);
							break;
						}
						
						data_to_send.variables.cursor = res.cursor;
					}
					
					res.list = [...res.list.values()];
					return res;
				});
				
				
				return {
					main,
				}
			})();
			
			const init = async () => {
				await auth.init();
				
				redis_connect.request.on["items_parser:request"] = request.main;
				
				console.log("items_parser:: is ready");
				return true;
			}
			
			return {
				init,
				auth, request,
			}
		})();
		
		
		await items_parser.init();
		
		
		// items_parser.request.main({risk_level: 5}).then(console.log, console.log)
		
		return true;
	})();
