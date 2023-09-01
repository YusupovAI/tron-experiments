const TronWeb = require('tronweb');
const { ethers } = require('ethers');

var EIP1967Proxy = artifacts.require("EIP1967Proxy");
var ZkBobPoolERC20 = artifacts.require("ZkBobPoolERC20");
var ZkBobDirectDepositQueue = artifacts.require("ZkBobDirectDepositQueue");
var MutableOperatorManager = artifacts.require("MutableOperatorManager");
var ZkAddress = artifacts.require("ZkAddress");
var Base58 = artifacts.require("Base58");

const abiCoder = new ethers.AbiCoder();
const ADDRESS_PREFIX_REGEX = /^(41)/;

function encodeParams(inputs) {
    let typesValues = inputs
    let parameters = ''

    if (typesValues.length == 0)
        return parameters
    let types = [];
    const values = [];

    for (let i = 0; i < typesValues.length; i++) {
        let {type, value} = typesValues[i];
        if (type == 'address')
            value = value.replace(ADDRESS_PREFIX_REGEX, '0x');
        else if (type == 'address[]')
            value = value.map(v => toHex(v).replace(ADDRESS_PREFIX_REGEX, '0x'));
        types.push(type);
        values.push(value);
    }

    // console.log(types, values)
    try {
        parameters = abiCoder.encode(types, values).replace(/^(0x)/, '');
    } catch (ex) {
        console.log(ex);
    }
    return parameters

}

module.exports = async function(deployer) {
    console.log(deployer);
    const usdt = TronWeb.address.toHex('TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs');
    const tronWeb = new TronWeb({
        fullNode: deployer.options.options.fullHost,
        solidityNode: deployer.options.options.fullHost,
    }, deployer.options.options.privateKey);

    const deployerAddress = TronWeb.address.toHex(deployer.options.options.from);
    await deployer.deploy(EIP1967Proxy, deployerAddress, usdt, []);
    const poolProxy = await EIP1967Proxy.deployed();

    const params = encodeParams([
        {type: 'uint256', value: '11469701942666298368112882412133877458305516134926649826543144744382391691533'}, // zkBobInitialRoot
        {type: 'uint256', value: '144115188075855871'}, // zkBobPoolCap
        {type: 'uint256', value: '8589934591'}, // zkBobDailyDepositCap
        {type: 'uint256', value: '8589934591'}, // zkBobDailyWithdrawalCap
        {type: 'uint256', value: '8589934591'}, // zkBobDailyUserDepositCap
        {type: 'uint256', value: '8589934591'}, // zkBobDepositCap
        {type: 'uint256', value: '0'}, // zkBobDailyUserDirectDepositCap
        {type: 'uint256', value: '0'}, // zkBobDirectDepositCap
    ]);

    var selector = ZkBobPoolERC20.web3.eth.abi.encodeFunctionSignature("initialize(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)");
    selector += params;
    console.log(poolProxy.address)
    var transaction = await tronWeb.transactionBuilder.triggerSmartContract(
        poolProxy.address,
        'upgradeToAndCall(address,bytes)',
        {},
        [
            {type: 'address', value: process.env.POOL_IMPL},
            {type: 'bytes', value: selector},
        ]
    );
    var signed = await tronWeb.trx.sign(
        transaction.transaction,
        deployer.options.options.privateKey,
    );
    var result = await tronWeb.trx.sendRawTransaction(signed);
    if (!result.result) {
        console.log('Could not initialize pool');
        return;
    }

    await deployer.deploy(Base58);
    await deployer.link(Base58, ZkAddress);
    await deployer.deploy(ZkAddress);
    await deployer.link(ZkAddress, ZkBobDirectDepositQueue);
    await deployer.deploy(ZkBobDirectDepositQueue, poolProxy.address, usdt, 1);
    const queueImpl = await ZkBobDirectDepositQueue.deployed();
    transaction = await tronWeb.transactionBuilder.triggerSmartContract(
        process.env.QUEUE_PROXY,
        'upgradeTo(address)',
        {},
        [
            {'type': 'address', 'value': queueImpl.address},
        ]
    );
    signed = await tronWeb.trx.sign(
        transaction.transaction,
        deployer.options.options.privateKey,
    );
    result = await tronWeb.trx.sendRawTransaction(
        signed
    );
    if (!result.result) {
        console.log('Could not upgrade queue proxy');
        return;
    }

    await deployer.deploy(
        MutableOperatorManager,
        deployerAddress, // relayer
        deployerAddress, // feeReceiver
        "https://relayer-mvp.zkbob.com",
    );
    const operatorManager = await MutableOperatorManager.deployed();

    transaction = await tronWeb.transactionBuilder.triggerSmartContract(
        process.env.QUEUE_PROXY,
        'setOperatorManager(address)',
        {},
        [
            {type: 'address', value: operatorManager.address}, 
        ]
    );
    signed = await tronWeb.trx.sign(
        transaction.transaction,
        deployer.options.options.privateKey,
    );
    result = await tronWeb.trx.sendRawTransaction(
        signed
    );
    if (!result.result) {
        console.log('Could not set operator manager for queue proxy');
        return;
    }

    transaction = await tronWeb.transactionBuilder.triggerSmartContract(
        poolProxy.address,
        'setOperatorManager(address)',
        {},
        [
            {type: 'address', value: operatorManager.address},
        ]
    );
    signed = await tronWeb.trx.sign(
        transaction.transaction,
        deployer.options.options.privateKey,
    );
    result = await tronWeb.trx.sendRawTransaction(
        signed
    );
    if (!result.result) {
        console.log('Could not set operator manager for pool');
        return;
    }

    console.log('Operator: ', tronWeb.address.fromHex(operatorManager.address));
    console.log('Pool: ', tronWeb.address.fromHex(poolProxy.address));
    console.log('Direct deposit queue: ', tronWeb.address.fromHex(process.env.QUEUE_PROXY));

};
