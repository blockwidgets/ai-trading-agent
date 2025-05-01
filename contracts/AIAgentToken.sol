// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AIAgentToken
 * @dev ERC20 Token for AI Agent App with claiming functionality
 */
contract AIAgentToken is ERC20, Ownable {
    uint256 public constant MAX_SUPPLY = 1000000 * 10**18; // 1 million tokens
    uint256 public constant CLAIM_AMOUNT = 100 * 10**18; // 100 tokens per claim
    
    // Track addresses that have already claimed
    mapping(address => bool) public hasClaimed;
    
    // Limit to 100 claiming wallets
    uint256 public claimCount = 0;
    uint256 public constant MAX_CLAIMING_WALLETS = 100;
    
    // Event emitted when tokens are claimed
    event TokensClaimed(address indexed user, uint256 amount);

    constructor() ERC20("AI Agent Token", "AIAG") Ownable(msg.sender) {
        // Mint initial supply to the contract creator
        // You can adjust this initial allocation as needed
        _mint(msg.sender, 1000000 * 10**18); // 1 million tokens initially to creator
    }
    
    /**
     * @dev Allow users to claim tokens (once per wallet)
     */
    function claimTokens() external {
        require(!hasClaimed[msg.sender], "Tokens already claimed");
        require(claimCount < MAX_CLAIMING_WALLETS, "Maximum claiming wallets reached");
        require(totalSupply() + CLAIM_AMOUNT <= MAX_SUPPLY, "Exceeds max supply");
        
        // Mark as claimed and increment claim count
        hasClaimed[msg.sender] = true;
        claimCount++;
        
        // Mint tokens to user
        _mint(msg.sender, CLAIM_AMOUNT);
        
        emit TokensClaimed(msg.sender, CLAIM_AMOUNT);
    }
    
    /**
     * @dev Check if an address has the minimum required tokens (100)
     * This can be called by your app's UI to verify token holdings
     */
    function hasMinimumTokens(address _user) external view returns (bool) {
        return balanceOf(_user) >= CLAIM_AMOUNT;
    }
    
    /**
     * @dev Allow owner to mint additional tokens (within max supply)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        require(totalSupply() + amount <= MAX_SUPPLY, "Exceeds max supply");
        _mint(to, amount);
    }
}