
var rskapi = require('rskapi');
var async = require('simpleasync');
var solc = require('solc');

var fs = require('fs');
var path = require('path');

var host = rskapi.host('http://localhost:4444');

var ctxfilename = 'context.json';
var context = loadContext(ctxfilename);

function setHost(url) {
	if (!url) {
		if (!host)
			host = rskapi.host('http://localhost:4444');
	}
	else
		host = rskapi.host(url);
}

function loadContext(filename) {
	if (!fs.existsSync(filename))
		return {};
	
	return JSON.parse(fs.readFileSync(filename).toString());
}

function saveContext(filename, ctx) {
	var text = JSON.stringify(ctx);
	
	fs.writeFileSync(filename, text);
}

function saveContract(name, value) {
	if (!context.contracts)
		context.contracts = {};
	
	context.contracts[name] = value;
}

function saveInstance(name, contractname, txhash, address) {
	if (!context.instances)
		context.instances = {};
	
	context.instances[name] = {
		contract: contractname,
		tx: txhash,
		address: address
	}
}

function sendTransaction(from, to, value, options, cb) {
    options = options || {};
    
    var txdata = {
        from: from,
		to: to,
        value: value,
        gas: options.gas || 21000,
        gasPrice: options.gasPrice || 1
    };
    
    if (options.data)
        txdata.data = options.data;

    host.sendTransaction(txdata, cb);
}

function sendCall(from, to, value, data, options, cb) {
    options = options || {};
    
    var txdata = {
        from: from,
		to: to,
        value: value,
        gas: options.gas || 21000,
        gasPrice: options.gasPrice || 1,
		data: data
    };

    host.callTransaction(txdata, cb);
}

function getTransactionReceipt(hash, ntry, cb) {
	if (ntry <= 0)
		return cb('transaction ' + hash + 'not mined');
	
    host.getTransactionReceiptByHash(hash, function (err, data) {
        if (err)
            return cb(err, null);
            
        if (data)
            return cb(null, data);
            
        setTimeout(function () {
            getTransactionReceipt(hash, ntry - 1, cb);
        }, 1000);
    });
}

function createContract(contractname, owner, value, options, cb) {
	var opts = {};
	
	opts.gas = options.gas || 3000000;
	opts.data = context.contracts[contractname].bytecode;
	
	var name = options.name || contractname;
	
	sendTransaction(owner, null, value, opts, function (err, txhash) {
		if (err)
			return cb(err);
		
		getTransactionReceipt(txhash, 60, function(err, txr) {
			if (err)
				return cb(err);
			
			saveInstance(name, contractname, txhash, txr.contractAddress);
			saveContext(ctxfilename, context);
			
			cb(null, name);
		});
	});
}

function findImports(path) {
    console.log('Import', path);
    return { contents: fs.readFileSync('./' + path).toString() };
    // return { error: 'File not found' }
}

function compileContract(filename, name) {
    var input = fs.readFileSync(filename).toString();
    var sources = {};
    sources[filename] = input;
    var output = solc.compile({ sources: sources }, 1, findImports); // 1 activates the optimiser

	if (!name) {
		var fullname = Object.keys(output.contracts)[0];
		var p = fullname.lastIndexOf(':');
		
		if (p >= 0)
			name = fullname.substring(p + 1);
		else
			name = fullname;
	}
	
	for (var n in output.contracts)
		if (n.endsWith(':' + name)) {
			var contract = output.contracts[n];
			
			saveContract(name, contract);
			saveContext(ctxfilename, context);
			
			return { name: name, contract: contract };
			
		}
}

function compile(args, options, cb) {
	var filename = path.join('.', 'contracts', args[0]);
	var name = args[1];
	
	setHost(options.host);
	
	try {
		var result = compileContract(filename, name);
		cb(null, result.name);
	}
	catch (err) {
		cb(err);
	}
}

function accounts(args, options, cb) {
	setHost(options.host);
	host.getAccounts(cb);
}

function number(args, options, cb) {
	setHost(options.host);
	host.getBlockNumber(cb);
};

function block(args, options, cb) {
	setHost(options.host);
	var id = args[0];
	
	if (typeof id === 'number' || id.length <= 10)
		host.getBlockByNumber(parseInt(id), cb);
	else
		host.getBlockByHash(id, cb);
};

function blocks(args, options, cb) {
	setHost(options.host);
	var id = args[0];
	
	host.getBlocksByNumber(parseInt(id), cb);
};

function balance(args, options, cb) {
	setHost(options.host);
	
	var address = args[0];
	
	host.getBalance(address, cb);
}

function balances(args, options, cb) {
	setHost(options.host);
	
	async()
	.exec(function (next) {
		host.getAccounts(next);
	}).map(function (data, next) {
		host.getBalance(data, function (err, balance) {
			cb(err, { account: data, balance: balance });
		});
	}).then(function (data, next) {
		cb(null, data);
	}).error(function (err) {
		cb(err);
	});
}

function deploy(args, options, cb) {
	setHost(options.host);
	
	createContract(args[0], args[1], args[2], options, cb);
}

function call(args, options, cb) {
	setHost(options.host);
	
	sendCall(args[0], args[1], args[2], options, cb);
}

function fns(args, options, cb) {
	var name = args[0];
	
	if (!context.contracts[name])
		return cb('unknown contract: ' + name);
	
	cb(null, Object.keys(context.contracts[name].functionHashes));
}

module.exports = {
	compile: compile,
	deploy: deploy,
	fns: fns,
	
	accounts: accounts,
	balance: balance,
	balances: balances,
	
	number: number,
	block: block,
	blocks: blocks
};

