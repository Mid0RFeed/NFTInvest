const {telegram: _config_telegram, redis,} = require(process.env.CONFIG_PATH__NFT);
const {asleep, create_id, rand, clone, _is,} = require(process.env.TOOLS_PATH__NFT);

const fs = require("fs");

redis.settings.set({debug: false});
const redis_connect = redis.connect_v2();

const telegram = (() => {
	const config = _config_telegram;
	
	
	const request = (() => {
		const _url = `https://api.telegram.org/bot${config.account.token}/`;
		const _request = require("request");
		
		return async (method, data, chat_id, options = {}) => {
			if (typeof data === "object") data = JSON.stringify(data);
			const _prepared_obj = {
				url: _url + method,
				body: {
					parse_mode: "HTML",
					chat_id,
					text: data,
					...options,
				},
				json: true,
			};
			//console.log("_prepared_obj::", _prepared_obj);
			const res = await new Promise((g) =>
				_request.post(_prepared_obj,
					(dom, res, body) => {
						console.log("body::", body);
						
						if (body instanceof Object) {
							if (body.ok === false) {
								switch (body.error_code) {
									default: {
										send(`Error send to TG: <pre>${JSON.stringify(body)}</pre>`);
										break;
									}
									case 400: {
										(async (method, data, chat_id, options) => {
											const data_arr = Array.from(data);
											while (data.length > 0) {
												const data_part = data_arr.splice(0, 3000).join("");
												request(method, data_part, chat_id, options);
											}
										})(method, data, chat_id, options);
										break;
									}
								}
							}
						}
						//console.log("body::", body, url_to_send + method)
						g(body);
					}
				)
			);
			console.log("telegram::send::request::res::", [data], [res]);
			return res;
		};
	})();
	const send = (msg, chat_name, options) => {
		const _chat_id = config.channels[chat_name] || chat_name;
		//console.log("telegram::send::", [chat_name, _chat_id], {msg, options});
		return request("sendMessage", msg, _chat_id, options);
	};
	
	const _handler_redis = data => {
		const data_to_send = {
			msg: data,
			chat: undefined,
			options: {},
		};
		if (data_to_send instanceof Object) {
			data_to_send.msg = data.msg;
			data_to_send.chat = data.chat;
			data_to_send.options = data.options || {};
		}
		
		return send(data_to_send.msg, data_to_send.chat, data_to_send.options)
	};
	
	const init = () => {
		redis_connect.on_channel("system:logger:telegram:send", _handler_redis);
		
		return true;
	};
	
	return {
		init,
		request, send,
	}
})();

(async () => {
	telegram.init();
})();