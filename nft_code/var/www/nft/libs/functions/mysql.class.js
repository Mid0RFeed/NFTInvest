const mysql_require = require('mysql');

// Async sleep
function asleep(mls) {
    return new Promise((g) => {
        setTimeout(() => {
            g(true);
        }, mls || 1)
    })
}


class mysql {
    constructor(config) {
        const self = this;
        
        this.config = config;
        this.create_connection();
        
        setInterval(() => {
            self.connection.ping();
        }, 60 * 1000);
    }
    
    create_connection() {
        let self = this;
        this.connection = mysql_require.createConnection(this.config);
        
        this.connection.connect(function (err) {
            if (err) {
                console.log('error when connecting to db::', err.message);
                setTimeout(function () {
                    self.create_connection();
                }, 500);
            } else {
                self.connection.query("SET SESSION wait_timeout = 604800");
            }
        });
        
        this.connection.on('error', function (err) {
            if (err.code === 'PROTOCOL_CONNECTION_LOST') {
                console.log('MySQL lost connection, reconnect::', err.message);
                self.create_connection();
            } else {
                console.log("MySQL some error::", err);
            }
            
        });
    }
    
    /**
     * @param sql
     * @param args
     * @param transform => Option: remove class `RowDataPacket` from rows
     * @returns {Promise<any>}
     */
    query(sql, args, transform) {
        const self = this;
        const system_errors = ["ER_SERVER_SHUTDOWN", "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR"];
        transform = transform === true;
        return new Promise((resolve, reject) => {
            //console.log("Go mysql query::", sql, args);
            this.connection.query(sql, args, async (err, rows, er) => {
                if (err) {
                    console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXx", err, rows, er);
                    
                    if (system_errors.indexOf(err.code) >= 0) {
                        console.log("wait re-query");
                        await asleep(1000);
                        await self.query(sql, args, transform).then(resolve, reject);
                    }
                    
                    return reject(err);
                }
                let return_this = [];
                if (transform === true) {
                    for (let cell in rows) {
                        return_this.push(Object.assign({}, rows[cell]));
                    }
                } else {
                    return_this = rows;
                }
                resolve(return_this);
            });
        });
    }
    
    close() {
        return new Promise((resolve, reject) => {
            this.connection.end(err => {
                if (err) return reject(err);
                resolve();
            });
        });
    }
}

module.exports = mysql;
