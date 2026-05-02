// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Multi-user SwarmFund
// Each depositor has a fully isolated vault within the contract.
// No user can access another user's funds.
// A bot wallet is authorized per-vault, not globally.

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract SwarmFund {

    struct Vault {
        address botWallet;
        mapping(address => uint256) balances;       // real deposited balance per token
        mapping(address => uint256) inflightFunds;  // funds currently held by bot mid-trade
        mapping(address => uint256) tradeLimits;    // max drawdown per trade per token
    }

    mapping(address => Vault) private vaults;

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event BotWalletSet(address indexed user, address indexed bot);
    event TradeLimitSet(address indexed user, address indexed token, uint256 limit);
    event DrawnDown(address indexed user, address indexed bot, address indexed token, uint256 amount);
    event FundsReturned(address indexed user, address indexed bot, address indexed tokenReturned, uint256 amountReturned, address tokenCleared, uint256 amountCleared);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyVaultBot(address user) {
        require(msg.sender == vaults[user].botWallet, "Not authorized bot for this vault");
        _;
    }

    // ─── User Functions ───────────────────────────────────────────────────────

    function deposit(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        vaults[msg.sender].balances[token] += amount;
        emit Deposited(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external {
        require(vaults[msg.sender].balances[token] >= amount, "Insufficient balance");
        vaults[msg.sender].balances[token] -= amount;
        IERC20(token).transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, token, amount);
    }

    function setBotWallet(address bot) external {
        vaults[msg.sender].botWallet = bot;
        emit BotWalletSet(msg.sender, bot);
    }

    function setTradeLimit(address token, uint256 limit) external {
        vaults[msg.sender].tradeLimits[token] = limit;
        emit TradeLimitSet(msg.sender, token, limit);
    }

    // ─── Bot Functions ────────────────────────────────────────────────────────

    function drawdown(address user, address token, uint256 amount) external onlyVaultBot(user) {
        require(amount <= vaults[user].tradeLimits[token], "Exceeds trade limit");
        require(vaults[user].balances[token] >= amount, "Insufficient vault balance");
        vaults[user].balances[token] -= amount;
        vaults[user].inflightFunds[token] += amount;
        IERC20(token).transfer(msg.sender, amount);
        emit DrawnDown(user, msg.sender, token, amount);
    }

    function returnFunds(
        address user,
        address tokenReturned,
        uint256 amountReturned,
        address tokenCleared,
        uint256 amountCleared
    ) external onlyVaultBot(user) {
        require(vaults[user].inflightFunds[tokenCleared] >= amountCleared, "Inflight underflow");
        vaults[user].inflightFunds[tokenCleared] -= amountCleared;
        vaults[user].balances[tokenReturned] += amountReturned;
        IERC20(tokenReturned).transferFrom(msg.sender, address(this), amountReturned);
        emit FundsReturned(user, msg.sender, tokenReturned, amountReturned, tokenCleared, amountCleared);
    }

    // ─── View Functions ───────────────────────────────────────────────────────

    function realBalance(address user, address token) public view returns (uint256) {
        return vaults[user].balances[token];
    }

    function inflightFunds(address user, address token) public view returns (uint256) {
        return vaults[user].inflightFunds[token];
    }

    function notionalBalance(address user, address token) public view returns (uint256) {
        return vaults[user].balances[token] + vaults[user].inflightFunds[token];
    }

    function harvestableAmount(address user, address token) public view returns (uint256) {
        uint256 notional = notionalBalance(user, token);
        uint256 limit = vaults[user].tradeLimits[token];
        return notional > limit ? notional - limit : 0;
    }

    function getBotWallet(address user) public view returns (address) {
        return vaults[user].botWallet;
    }

    function getTradeLimit(address user, address token) public view returns (uint256) {
        return vaults[user].tradeLimits[token];
    }
}
