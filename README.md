# FlexCheck
V1 of Launching the FlexCheck

Full doc: https://docs.google.com/document/d/1bq8BbJXLGcrKddRoZcez3MOxr5eSo3AS5vZ3FOMZSbs/edit?pli=1&tab=t.j9epg0ckhcio#heading=h.vc4em4nibgde
Refer to tab: Full documentatoion

Main architecture (Free Flex Check):
Helpful references for free flexcheck - how everything works for physique check and waitlist (everyone on waitlist will be sent a free FlexCheck):
https://docs.google.com/document/d/1ZFbB8PzD6FMYYdhjqgmpzjq6MjXuwsE25rNvvqQ3rMU/edit?pli=1&tab=t.2dki5hg3nw05 
Also related to the waitlist in general, but links the waitlist to 
Free FlexCheck:
Get email with one time free version of flexcheck - partial features
Only for people in the waitlist, i only want to set it up so it works with manually sending emails
Email contains unique URL with email & ticket #
Sheet #1: making the waitlist fun https://docs.google.com/spreadsheets/d/1h66WWESaFjq7s8ZTDFPTkORufEDVO8iQhSDLe0RaCYs/edit?gid=0#gid=0 
Goes to this site: https://www.gameplanfitness.com/services/physique-check/free-flexcheck/ 
But requires ticket # and email
To test i use: https://www.gameplanfitness.com/services/physique-check/free-flexcheck/?ticket=1776&email=toadhu@gmail.com 
To invite people to the free flexcheck, i would need to generate this URL for the users as they likely would not know how to do this themselves. Then i can strategically release free FlexChecks
Users fill out the flexcheck with their unique login (no coupon) 
FREE FC GAS (only 1 for Free - “FlexCheckFree-DEV”) does stuff
Script: https://script.google.com/home/projects/1vOFXcPAoZSJVVaSPVW1KazKORkY8RVzs8iUsCWwJJYHKTBnLx3PcGm1v/edit 
ENDPOINT: https://script.google.com/macros/s/AKfycbzI8AhHWmaRAEmzG3lJvmLXnEqGYpdPdQVLPD3bi3-NVAOaeO-4ZuMu3s_IBhFqa6BBpA/exec 
GAS saves stuff to a google sheet #2 (free FlexCheck Sheet)
https://docs.google.com/spreadsheets/d/1zne4Lfb6Lgp13BryrSaXnRFBSox84Ysxc9ut_MR7biY/edit?pli=1&gid=0#gid=0
NOTE: ticket 1775 + toadhu@gmail.com = good for testing
1776 + chase.ribordy@gmail.com was messed up as i developed premium flexcheck
Form results sent to GPT api (via GAS “doPost”)
NOTE: Codename Tracker -> used for keeping track of if the Free was redeemed yet
Sheet #1: making the waitlist fun https://docs.google.com/spreadsheets/d/1h66WWESaFjq7s8ZTDFPTkORufEDVO8iQhSDLe0RaCYs/edit?gid=0#gid=0 
Refer to “Headers” tab to see labels
Email sent to user to have a unique URL with ticket & email
GPT processes and sends back a JSON
Front End renders (via GAS “doGet”)
On this URL: https://www.gameplanfitness.com/flexcheck-freeresults/ 
Requires ticket #
To test: https://www.gameplanfitness.com/flexcheck-freeresults/?ticket=1775 
Populates with this GAS “FlexCheckFree-DEV” (same):
https://script.google.com/macros/s/AKfycbzI8AhHWmaRAEmzG3lJvmLXnEqGYpdPdQVLPD3bi3-NVAOaeO-4ZuMu3s_IBhFqa6BBpA/exec 
Then the goal is to get them to check out the premium flexcheck

Testing (Free FlexCheck)
Premise
I will be testing with 1776 + toadhu 
https://www.gameplanfitness.com/services/physique-check/free-flexcheck/?ticket=1776&email=toadhu@gmail.com 
-> i first need to check “making the waitlist fun” 
-> if Column F “snapRedeemed” = TRUE (SnapCheck was the previous name) then this will NOT work. 
This means people need to have filled out the Physique Check form to be able to redeem this offer since they need a ticket # and need to have not redeemed the Free FlexCheck Yet
To Test Again, I would simply need to reset “snapRedeemed” = FALSE
When testing, the Ticket already existing is not a problem, it will only however update the “resultJson” row.
I would also recommend pulling up the openai api usage to make sure it is properly running + can also look at GAS to see if it runs (making sure GAS endpoint for deployment matches what the form is calling -> also make sure the endpoint URL for doGet for Frontend rendering also is the right one for results page.
Upon running
The GAS execution history should show “running” after a couple seconds
The “Waitlist is Fun” Sheet should soon have Column F “snapRedeemed” = TRUE
The “FlexCheck Free” Sheet will be updated (appending a new row if the ticket is new OR you have to wait for the GPT call to populate the column E “resultJson”
The GPT call should show up as usage on the API
An email will be sent -> should take the user to their results page
If an edit needs to be made to the GAS
Make edits in the editor of the GAS & save
Saving alone is not enough to deploy changes. You need to redeploy the GAS to execute the new version of the code.
Copy the current GAS web url -> Find all the places that use the CURRENT endpoint URL along the pipeline and highlight with Ctrl+F. 
Once confirmed, make sure all of your GAS edits are correct with no small errors. After passing this QA checkpoint, it is time to update the web app URL everywhere.
Ex: check output wording (emails + JSON for FE render + GPT output is reasonable values), assure no env variables exposed like API keys
Finally, redeploy GAS and copy paste the NEW endpoint URL over the CURRENT URL.
Retest to Guarantee everything functions as expected



Main FlexCheck Offer
References
Test
Problems with Free? (test with 1776 + toadhu)
Not really, works pretty well. The rating is kind of basic and seems to only be in increments of 5.
Works fine with anime characters
Problems with Paid? (submit new?)
Need to save my code on Github: <URL>



Main Architecture: (premium FlexCheck)
TouchPoint
Some people will come from waitlist -> free FlexCheck -> premium form -> detour people: https://www.gameplanfitness.com/flexcheck/ -> premium form
Some people will come from social media directly -> https://www.gameplanfitness.com/flexcheck/ -> premium form
Form: https://www.gameplanfitness.com/flexcheck/premium-flexcheck/ 
Webhooks: only 1: GAS #1; noted below: https://script.google.com/home/projects/1I-wfyDXcYrDy1GVFRvf08UZNIJ0k2_NM3ya2-HuDWuLsKp7J8yoP96qi/edit 
Form -> GAS 
PAID GAS #1 (Submission-GPT-Email) **MOST IMPORTANT GAS**
https://script.google.com/home/projects/1I-wfyDXcYrDy1GVFRvf08UZNIJ0k2_NM3ya2-HuDWuLsKp7J8yoP96qi/edit 
JSON post from fluent form to GAS
GAS (via “doPost”)
writes to sheet #1 (writes to submissions tab)
https://docs.google.com/spreadsheets/d/1bshL5-uBrkz3pMr9SiAMnQaR_Zzk-WWlN7inofEc5p0/edit?gid=1803730285#gid=1803730285 
Submissions Tab
Processed Tab
Content sent to GPT api
JSON result plugged into submissions tab “resultJson”
Submission tab parsed to convert into more readable format in “Processed” tab to then be used for front end rendering
Send Email Confirmation with Unique Link and Entry Id
Also notes the next Championship date dynamically rendered to stay tuned
User will go to hydrated flexcheck playercard
Test with generic: https://www.gameplanfitness.com/flexcheck/flexcheck-player-card/?entryId=1002
Or with entry ID: 2853 -> my personal data
Player Card (Multiple Gas scripts to Render Frontend)
GAS #2 GAS 3 - FlexCheck Render (for navbar & login to hydrate the URL with entry ID) 
Script: https://script.google.com/home/projects/1U_KXZ4pw6zcf9Ywgkb6bHxb0JGnRfkmEsxMcMXZSiMySNK-GXxrB5lTo/edit 
ENDPOINT: https://script.google.com/macros/s/AKfycbz8Uf7b7CUidKpmY5Vf8C-ejYOx8K-qCcJmNwyvTqQzH9PooXRJNqyZGzI61tN6mIsX/exec 
GAS #3 (GASmiscFlexCheck_Achievements) - for achievements section ONLY
Script: https://script.google.com/home/projects/1efSU50HGjJV51F31LWQF_ML1HYu57F8z50opUwKWLUzHzYQPvtkeSzfu/edit 
ENDPOINT: https://script.google.com/macros/s/AKfycbxy8i4LPu7-__E5vwrm9YTo_3KnhC2LtshWFNBeur-Dd-XiNfhUF1sEoBy6Lkc4ZG10ow/exec 
GAS #4 (GASmisc_fullBreakdown) - full breakdown
Script: https://script.google.com/home/projects/1ijiZqt85gpdKq-Y0dF0xyT46pwccFa0pGKfw1vJPVVKFQwVBmkzs3YdA/edit 
ENDPOINT: https://script.google.com/macros/s/AKfycbxmySjLLGynKo_k_YuqnONRqaoSXnY-x3oXmdXjgBd-7qdhrt3lBR28c1_sq5_yKhu5TQ/exec 
GAS #5 (GASmisc_rivals) - rivals
Script: https://script.google.com/home/projects/1lw6I0ThGsOgUiIVgjBez8E7TR1_R_kz6TpN-2qtHwPbkHcRnd6Q0pHbb/edit 
Endpoint: https://script.google.com/macros/s/AKfycbyo90wmB5BYtMIzrozQ1sqLAOHxlxZJw6sow_l2iCuP_lRpBNP7hHbe-1O9cHxQllG2Lw/exec 
Leaderboard
Top 10: Gas #6 (GASmisc_Top10Updater) - leaderboard, only one for rendering
Script: https://script.google.com/home/projects/10nopBpBHA1aR3Hr9XLoWG_87tzUcBzKPJ0-5XnTmj9JYwhhS2mi9tvKl/edit 
Endpoint: https://script.google.com/macros/s/AKfycbzgvbWWjQNPdUTJeGmq0-790Vm7enUQvHW2B3Dy6wYre3jp98gQdpNMcTm3YXvGnLXW7Q/exec 
Force top 10 (different; i think it was for testing? lol)
Script: https://script.google.com/home/projects/1fvYRzvkHjFX0bNt5y_Z_0WqVNIzu9GvrQ_a5phQhC0M1aemHrLJshvCv/edit
Endpoint: https://script.google.com/macros/s/AKfycbzIUhqVd6dAdmOmEiRsyF3xKApTOm2MESa0aR_DH_42QsZlEyBn6cN4HSclGwm4MXCC/exec 

Testing (Premium FlexCheck)
Premise
I will be testing from an incognito window starting here: https://www.gameplanfitness.com/flexcheck/
Need to make sure the cache is cleared (F12 -> application -> make sure no cache)
First, check to make sure the demo is looking good on each of the pages with no bugs. Make sure everything is functional by clicking buttons.
Filling out the form -> due to the nature of this, all i need to do is make some legit entries.
Test all the way through to make sure overall output works (otherwise things get hard and i have to narrow down what went wrong lol -> but it’s relatively modular and easy to track down)


URL
Player Card
https://www.gameplanfitness.com/flexcheck/flexcheck-player-card/?entryId=1001
Home
https://www.gameplanfitness.com/flexcheck/
Leaderboard
https://www.gameplanfitness.com/flexcheck/flexcheck-leaderboard?entryId=1001 


The main FE containers:

My Card
Show the relevant blocks based on if signed in or not
Navbar
Submit or log out
Player card
Achievements
See Full Breakdown
Your Rivals
View Past Flexchecks
–conditional Demo for non-signed in user–
Demo player card
Example Player Card Text Container
Demo Achievements 
Demo Full Breakdown
Demo Rivals
Demo Past FlexChecks
Player Guide Light up container
GP divider
Challenge glow
Challenges Container
Home
Navbar
Countdown
Submit check
What is a flexcheck
Divider transition (flexcheck feedback -> championship)
Submit vote win
GP divider
Ready to compete
Each of the containers
Tiers
Competition
Voting
Championship
Rewards
FAQ
Final CTA
Leaderboard
Navbar
Leaderboard + tier selector
Top 10 Leaderboard
Submit flexcheck CTA
Finals Countdown
Timeline
GP logo divider
FlexCheck Discussion
