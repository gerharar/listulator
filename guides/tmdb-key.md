# Get a TMDB API key

**Used for:** searching movies, TV, animation and documentaries on The Movie Database
**Site:** [themoviedb.org](https://www.themoviedb.org)
**Last checked:** _not yet written up_

A personal key is free and is approved on the spot.

## 1. Create an account and open the API settings

Create a free account, sign in, then go to **Settings**:

![TMDB - Settings](images/tbdm-01.png)

## 2. Request a Developer key

Go to **API** then hit **click here** under *Request an API key*:

![TMDB - API key request](images/tbdm-02.png)

## 3. Confirm personal use

Confirm that you need the key strictly for personal use. The following part seems to be regularly updated with more questions, so you might see something different:

![TMDB - personal confirmation 1](images/tbdm-03.png)
![TMDB - personal confirmation 2](images/tbdm-04.png)

## Provide necessary details

Provide application details in the top form (data from screenshot below works fine):

![TMDB - dev info; top part](images/tbdm-05.png)

- **App name:** *Listulator*
- **App URL:** *http://example.com*
- **Summary:** *I'll use this key for Listulator app (free serialized media checklister)*

Provide your personal data in the bottom form and hit **Subscribe**:

**Note**: The validation for these fields is very basic, so don't worry much about them. Since TMDB seems to be sketchy in terms of GDPR compliance, I'd be wary of providing your real data here

![TMDB - personal info; bottom part](images/tbdm-06.png)

## 3. Copy the key into Listulator

Hit **"Access your API key details here"**:

![TMDB - API key details](images/tbdm-07.png)

Copy the **API Key** (not the long *API Read Access Token*) from the bottom of the screen: 

![TMDB - API key details](images/tbdm-08.png)

You're almost done! Go to **Settings** in Listulator, paste the key into the *TMDB* row and press **Test**. The app should say **Working**. Enjoy searching TMDB in Listulator!